#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
RELEASE_REPO="Asgarrrr/Inkra"

NOTES_FILE=""
UNSIGNED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --notes-file)
      NOTES_FILE="$2"
      shift 2
      ;;
    --notes-file=*)
      NOTES_FILE="${1#*=}"
      shift
      ;;
    --unsigned)
      UNSIGNED=1
      shift
      ;;
    *)
      echo "Error: unknown argument: $1"
      echo "Usage: $0 --notes-file <path> [--unsigned]"
      exit 1
      ;;
  esac
done

if [ -z "$NOTES_FILE" ]; then
  echo "Error: --notes-file <path> is required"
  echo "Pass a markdown file with the user-facing release notes (drafted by the agent from CHANGELOG.md)."
  exit 1
fi
if [ ! -s "$NOTES_FILE" ]; then
  echo "Error: notes file is missing or empty: $NOTES_FILE"
  exit 1
fi

# Load environment variables
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env file not found at $ENV_FILE"
  echo ""
  echo "Create it with:"
  echo "  APPLE_SIGNING_IDENTITY=\"Developer ID Application: Your Name (TEAMID)\""
  echo "  APPLE_ID=\"your@apple.id\""
  echo "  APPLE_PASSWORD=\"xxxx-xxxx-xxxx-xxxx\"  # app-specific password"
  echo "  APPLE_TEAM_ID=\"XXXXXXXXXX\""
  echo "  TAURI_SIGNING_PRIVATE_KEY=\"/absolute/path/to/inkra-updater-key\""
  echo "  TAURI_SIGNING_PRIVATE_KEY_PASSWORD=\"\"  # empty if keypair has no password"
  echo "  INKRA_POSTHOG_KEY=\"phc_...\"  # or set INKRA_RELEASE_WITHOUT_TELEMETRY=1 to ship without it"
  echo ""
  echo "Without a Developer ID certificate, pass --unsigned: only the updater"
  echo "key and the telemetry key are then required. See docs/releasing.md."
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

# The updater key and its passphrase live in the macOS keychain so `.env` holds
# no secret. An explicit value in `.env` still wins, which keeps one-off
# overrides and any future CI working. tauri-cli accepts the key itself here,
# not only a path to it, so the private key never has to touch the build's
# environment from disk.
KEYCHAIN_ACCOUNT="inkra"
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  TAURI_SIGNING_PRIVATE_KEY=$(security find-generic-password \
    -a "$KEYCHAIN_ACCOUNT" -s inkra-updater-key -w 2>/dev/null || true)
  export TAURI_SIGNING_PRIVATE_KEY
fi
if [ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]; then
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$(security find-generic-password \
    -a "$KEYCHAIN_ACCOUNT" -s inkra-updater-key-password -w 2>/dev/null || true)
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
fi

# The updater key is required either way — it is what existing installs check
# an update against, and it has nothing to do with Apple. The Apple credentials
# are what make a release signed and notarized, so they are required only when
# that is what we are producing.
REQUIRED_VARS="TAURI_SIGNING_PRIVATE_KEY"
if [ "$UNSIGNED" -eq 0 ]; then
  REQUIRED_VARS="APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID $REQUIRED_VARS"
fi

for var in $REQUIRED_VARS; do
  if [ -z "${!var:-}" ]; then
    if [ "$var" = "TAURI_SIGNING_PRIVATE_KEY" ]; then
      echo "Error: no updater key in the keychain, and none set in .env"
      echo "  expected keychain item: service 'inkra-updater-key', account '$KEYCHAIN_ACCOUNT'"
      echo "  See docs/releasing.md for how the key is stored."
    else
      echo "Error: $var is not set in .env"
    fi
    exit 1
  fi
done

# `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is optional but tauri-cli checks the env
# var is present — export an empty default so the build doesn't fail on macOS.
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

# Opt-in telemetry is compiled in only when a project key is present. A keyless
# release is a working release with telemetry permanently inert, and the only
# symptom is silence in PostHog long after it has shipped — so this fails
# unless the omission is explicit. See docs/telemetry.md.
if [ -z "${INKRA_POSTHOG_KEY:-}" ] && [ "${INKRA_RELEASE_WITHOUT_TELEMETRY:-}" != "1" ]; then
  echo "Error: INKRA_POSTHOG_KEY is not set — this build would ship with telemetry permanently inert."
  echo "Add it to $ENV_FILE, or set INKRA_RELEASE_WITHOUT_TELEMETRY=1 to release without it on purpose."
  exit 1
fi

# The release build runs through `vp`, but the toolchain is a workspace
# dependency rather than a global CLI, so a bare `vp` only resolves when a
# package runner has already put `node_modules/.bin` on PATH. Resolve it here:
# the build is the first thing after `git push origin master`, and a PATH
# problem discovered there leaves the branch pushed with nothing to show for it.
VP_BIN="$(command -v vp || true)"
if [ -z "$VP_BIN" ] && [ -x "$ROOT_DIR/node_modules/.bin/vp" ]; then
  VP_BIN="$ROOT_DIR/node_modules/.bin/vp"
fi
if [ -z "$VP_BIN" ]; then
  echo "Error: vp not found on PATH or in $ROOT_DIR/node_modules/.bin"
  echo "Run 'vp install' from the repository root first."
  exit 1
fi

if [ "$UNSIGNED" -eq 1 ]; then
  # Ad-hoc sign rather than leave the bundle bare. With no identity at all the
  # linker signs the inner binary but no `_CodeSignature` seal is written, and
  # `codesign --verify` rejects the bundle outright — macOS surfaces that as
  # "damaged", which right-clicking does not get past. Identity `-` produces a
  # seal that is valid and self-consistent, merely signed by no authority.
  export APPLE_SIGNING_IDENTITY="-"

  # tauri-cli infers notarization from these, so clearing them is what skips
  # it. It also stops a stale `.env` from half-configuring an Apple submission.
  unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID
  unset APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD
  unset APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH

  echo "warning: building ad-hoc signed and unnotarized — macOS blocks this on"
  echo "         first open, and users must clear quarantine by hand."
  echo ""
else
  # Signing and notarization both need a Developer ID Application identity,
  # which an Apple Development certificate does not satisfy. Left to fail on
  # its own, that surfaces after the full release build and a round trip to
  # Apple — so match the configured name against the keychain up front.
  if ! security find-identity -v -p codesigning 2>/dev/null | grep -qF "$APPLE_SIGNING_IDENTITY"; then
    echo "Error: no codesigning identity in the keychain matches APPLE_SIGNING_IDENTITY"
    echo "  looking for: $APPLE_SIGNING_IDENTITY"
    echo "  available:"
    security find-identity -v -p codesigning 2>/dev/null | sed 's/^/  /'
    echo ""
    echo "Notarized releases need a 'Developer ID Application' certificate, issued"
    echo "only under a paid Apple Developer Program membership. To release without"
    echo "one, re-run with --unsigned."
    exit 1
  fi
fi

# Read version from tauri.conf.json
TAURI_CONF="$ROOT_DIR/apps/desktop/src-tauri/tauri.conf.json"
VERSION=$(python3 -c "import json; print(json.load(open('$TAURI_CONF'))['version'])")
TAG="v$VERSION"

# Pre-flight: must be on master, clean, in sync with origin, and the tag must
# not already exist anywhere. These checks are cheap — fail before the long
# release build rather than after.
CURRENT_BRANCH=$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "master" ]; then
  echo "Error: releases must be cut from master, currently on '$CURRENT_BRANCH'"
  exit 1
fi

if ! git -C "$ROOT_DIR" diff-index --quiet HEAD --; then
  echo "Error: working tree has uncommitted changes — commit the version bump first"
  git -C "$ROOT_DIR" status --short
  exit 1
fi

echo "Fetching origin to verify sync..."
git -C "$ROOT_DIR" fetch origin master --tags

LOCAL_REV=$(git -C "$ROOT_DIR" rev-parse HEAD)
REMOTE_REV=$(git -C "$ROOT_DIR" rev-parse origin/master)
BASE_REV=$(git -C "$ROOT_DIR" merge-base HEAD origin/master)
if [ "$LOCAL_REV" != "$REMOTE_REV" ] && [ "$BASE_REV" != "$REMOTE_REV" ]; then
  echo "Error: local master is not a fast-forward of origin/master"
  echo "  local:  $LOCAL_REV"
  echo "  origin: $REMOTE_REV"
  echo "  Pull or rebase before releasing."
  exit 1
fi

if git -C "$ROOT_DIR" rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null; then
  echo "Error: tag $TAG already exists locally — bump the version or delete the tag"
  exit 1
fi
if git -C "$ROOT_DIR" ls-remote --tags --exit-code origin "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "Error: tag $TAG already exists on origin — bump the version"
  exit 1
fi

# Push master so the commit the release points at is on origin before we build.
# Idempotent if local already matches origin.
echo "Pushing master to origin..."
git -C "$ROOT_DIR" push origin master

echo "Building Inkra $TAG..."

# Build signed and notarized DMG + updater artifacts (.app.tar.gz + .sig).
cd "$ROOT_DIR/apps/desktop"
"$VP_BIN" exec tauri build --bundles app,dmg

BUNDLE_DIR="$ROOT_DIR/apps/desktop/src-tauri/target/release/bundle"
DMG_DIR="$BUNDLE_DIR/dmg"
MACOS_DIR="$BUNDLE_DIR/macos"

# `bundle/` is never cleaned between builds, so it accumulates artifacts from
# earlier versions and even earlier product names. Taking the first glob match
# would pick `Inkra_0.6.0` ahead of `Inkra_0.7.0` on the next release and
# publish the previous binary under the new tag, with nothing to signal it.
# Pin every artifact to the product name and the version being released.
PRODUCT_NAME=$(python3 -c "import json; print(json.load(open('$TAURI_CONF'))['productName'])")

DMG_MATCHES=$(find "$DMG_DIR" -maxdepth 1 -name "${PRODUCT_NAME}_${VERSION}_*.dmg" 2>/dev/null | sort)
DMG_COUNT=$(printf '%s' "$DMG_MATCHES" | grep -c . || true)
DMG_FILE=$(printf '%s' "$DMG_MATCHES" | head -1)
TAR_FILE="$MACOS_DIR/${PRODUCT_NAME}.app.tar.gz"
SIG_FILE="$TAR_FILE.sig"

if [ "$DMG_COUNT" -ne 1 ]; then
  echo "Error: expected exactly one DMG for $PRODUCT_NAME $VERSION in $DMG_DIR, found $DMG_COUNT"
  [ -n "$DMG_MATCHES" ] && printf '%s\n' "$DMG_MATCHES" | sed 's/^/  /'
  exit 1
fi

if [ ! -f "$TAR_FILE" ] || [ ! -f "$SIG_FILE" ]; then
  echo "Error: Updater artifacts missing in $MACOS_DIR"
  echo "  Expected: $(basename "$TAR_FILE") and $(basename "$SIG_FILE")"
  echo "  Check that \`createUpdaterArtifacts\` is true and TAURI_SIGNING_PRIVATE_KEY is valid."
  exit 1
fi

echo ""
echo "Built: $(basename "$DMG_FILE") ($(du -h "$DMG_FILE" | cut -f1))"
echo "Built: $(basename "$TAR_FILE") ($(du -h "$TAR_FILE" | cut -f1))"

# Determine target triple for latest.json (arm64 host → aarch64).
HOST_ARCH=$(uname -m)
case "$HOST_ARCH" in
  arm64|aarch64) TARGET="darwin-aarch64" ;;
  x86_64) TARGET="darwin-x86_64" ;;
  *) echo "Error: unsupported host architecture $HOST_ARCH"; exit 1 ;;
esac

SIGNATURE=$(cat "$SIG_FILE")
TAR_NAME=$(basename "$TAR_FILE")
PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
NOTES="Inkra $TAG"
DOWNLOAD_URL="https://github.com/$RELEASE_REPO/releases/download/$TAG/$TAR_NAME"

LATEST_JSON="$BUNDLE_DIR/latest.json"
python3 - "$LATEST_JSON" "$VERSION" "$NOTES" "$PUB_DATE" "$TARGET" "$SIGNATURE" "$DOWNLOAD_URL" <<'PY'
import json, sys
out_path, version, notes, pub_date, target, signature, url = sys.argv[1:]
payload = {
    "version": version,
    "notes": notes,
    "pub_date": pub_date,
    "platforms": {
        target: {
            "signature": signature,
            "url": url,
        }
    },
}
with open(out_path, "w") as f:
    json.dump(payload, f, indent=2)
PY

echo "Built: latest.json ($TARGET)"

# An unsigned build is refused by Gatekeeper on first open, with a dialog that
# offers no way past it — the release is unusable without the workaround, so it
# ships attached to the download rather than left for the reader to find.
RELEASE_NOTES_FILE="$NOTES_FILE"
if [ "$UNSIGNED" -eq 1 ]; then
  RELEASE_NOTES_FILE=$(mktemp -t inkra-release-notes)
  trap 'rm -f "$RELEASE_NOTES_FILE"' EXIT
  cat "$NOTES_FILE" > "$RELEASE_NOTES_FILE"
  cat >> "$RELEASE_NOTES_FILE" <<'GATEKEEPER'

---

**This build is not signed by Apple**, so macOS blocks it the first time you
open it. Drag Inkra to Applications first, then:

1. Right-click Inkra, choose **Open**, and confirm. For most people that is
   enough, and macOS remembers the choice.
2. If macOS instead says Inkra is **damaged**, that dialog has no way past it.
   Open Terminal and run:

   ```
   xattr -dr com.apple.quarantine /Applications/Inkra.app
   ```

   Then open Inkra normally.

Once it has opened once, later launches and in-app updates work as usual.
GATEKEEPER
fi

# Create a DRAFT GitHub Release with DMG, updater tarball, signed manifest,
# and the agent-drafted user-facing notes.
echo ""
echo "Creating draft release $TAG on $RELEASE_REPO..."

gh release create "$TAG" "$DMG_FILE" "$TAR_FILE" "$LATEST_JSON" \
  --repo "$RELEASE_REPO" \
  --title "Inkra $TAG" \
  --notes-file "$RELEASE_NOTES_FILE" \
  --draft

DRAFT_URL=$(gh release view "$TAG" --repo "$RELEASE_REPO" --json url --jq '.url')

# Tag this repo so the release artifact is pinned to a specific commit. If you
# end up abandoning the draft, delete the tag manually.
echo ""
echo "Tagging $TAG locally and pushing to origin..."
git -C "$ROOT_DIR" tag "$TAG"
git -C "$ROOT_DIR" push origin "$TAG"

echo ""
echo "Draft created: $DRAFT_URL"
echo "Review the notes and click Publish to ship it."
