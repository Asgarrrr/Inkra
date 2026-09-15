import type { Platform } from "@/lib/platform";

export { detectPlatform, type Platform } from "@/lib/platform";

const PLATFORM_MENU_LABELS = {
  macos: {
    reveal: "Reveal in Finder",
    openFolder: "Open in Finder",
  },
  windows: {
    reveal: "Reveal in Explorer",
    openFolder: "Open in Explorer",
  },
  linux: {
    reveal: "Show in Folder",
    openFolder: "Open in File Manager",
  },
} satisfies Record<Platform, { reveal: string; openFolder: string }>;

export function revealLabelForPlatform(platform: Platform): string {
  return PLATFORM_MENU_LABELS[platform].reveal;
}

export function openFolderLabelForPlatform(platform: Platform): string {
  return PLATFORM_MENU_LABELS[platform].openFolder;
}
