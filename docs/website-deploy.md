# Website Deploy

The marketing website lives in `apps/website/` and deploys to the Cloudflare Worker service `inkra-website`.

## Configuration

- Worker config: `wrangler.jsonc`
- Worker name: `inkra-website`
- Static assets directory: `apps/website/dist/client`
- Production URL: none yet — Inkra has no domain registered. `apps/website/src/routes/__root.tsx` carries `https://inkra.invalid` as an unresolvable placeholder for the Open Graph tags; replace it and this line together once the domain exists.
- Analytics: `INKRA_POSTHOG_KEY` from the repo-root `.env`, shared with the desktop app — see [website-analytics.md](./website-analytics.md)

The Worker name in Cloudflare must match `name` in `wrangler.jsonc` so local deploys update the intended service.

## Deploy Locally

Deploys are run manually from a local machine using Wrangler CLI. From the repository root:

```sh
bun install
set -a; source .env; set +a
bun run --filter website build
bunx wrangler deploy --config wrangler.jsonc
```

The `source .env` line is what supplies the analytics key: the site shares the
desktop app's PostHog project via `INKRA_POSTHOG_KEY`, and the website build
does not load that file on its own. The key is read by the **build**, not by the
Worker — it is inlined into the client bundle, so a Cloudflare Worker variable
or secret has no effect, and building without it deploys a site that sends
nothing. Only `INKRA_POSTHOG_KEY` and `INKRA_POSTHOG_HOST` are bridged into
the bundle by name; the signing credentials in that same `.env` are not, and
`apps/website/vite.config.ts` explains why it has to stay that way. See
[website-analytics.md](./website-analytics.md).

Wrangler must be logged into the Cloudflare account that owns `inkra-website`:

```sh
bunx wrangler login
```

Verify the deployment against the `*.workers.dev` URL that Wrangler prints, or
against the production domain once one is registered:

```sh
curl -I https://<deployed-url>
```

## Notes

- Do not use GitHub Pages for this website.
- Do not rely on Cloudflare Git Builds for this website unless this document is updated first.
- Keep `wrangler.jsonc` at the repository root so local Wrangler deploys use the same Worker settings.
- Run `biome check` before deploying source changes when practical.
