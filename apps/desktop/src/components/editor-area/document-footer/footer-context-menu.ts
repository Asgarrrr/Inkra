import { Menu } from "@tauri-apps/api/menu/menu";
import { CheckMenuItem } from "@tauri-apps/api/menu/checkMenuItem";
import type { DocumentStats } from "@/lib/document-stats";

/**
 * Registry of the footer metrics: which stat each one shows, the label
 * rendered in the footer, the label shown in the context menu, and the
 * setting key that controls its visibility. The footer and its context menu
 * both iterate this list — add a metric here and both stay in sync.
 */
export const FOOTER_METRICS = [
  {
    settingKey: "statusbar.show-words",
    statKey: "words",
    footerLabel: "words",
    menuLabel: "Words",
  },
  {
    settingKey: "statusbar.show-characters",
    statKey: "characters",
    footerLabel: "characters",
    menuLabel: "Characters",
  },
  {
    settingKey: "statusbar.show-paragraphs",
    statKey: "paragraphs",
    footerLabel: "paragraphs",
    menuLabel: "Paragraphs",
  },
] as const satisfies ReadonlyArray<{
  settingKey: string;
  statKey: keyof DocumentStats;
  footerLabel: string;
  menuLabel: string;
}>;

export type FooterMetricSettingKey = (typeof FOOTER_METRICS)[number]["settingKey"];

export interface FooterContextMenuState {
  /** Current visibility per metric setting key. */
  visibility: Record<FooterMetricSettingKey, boolean>;
  /** Called with the setting key and the new visibility value. */
  onToggle: (key: FooterMetricSettingKey, visible: boolean) => void;
}

/**
 * Build the check-item entries for the footer context menu. Every metric is
 * always listed (checked = currently visible) so a hidden metric can be
 * re-shown from the same menu. Pulled out from `showFooterContextMenu` so it
 * can be unit-tested without the Tauri runtime.
 */
export function buildFooterMenuItemsSpec(
  state: FooterContextMenuState,
): Array<{ id: FooterMetricSettingKey; text: string; checked: boolean; action: () => void }> {
  return FOOTER_METRICS.map(({ settingKey, menuLabel }) => ({
    id: settingKey,
    text: menuLabel,
    checked: state.visibility[settingKey],
    action: () => state.onToggle(settingKey, !state.visibility[settingKey]),
  }));
}

/**
 * Build a Tauri native menu of check items and pop it up at the cursor.
 * The menu dismisses through the OS, not via JS.
 */
export async function showFooterContextMenu(state: FooterContextMenuState): Promise<void> {
  const spec = buildFooterMenuItemsSpec(state);

  const items = await Promise.all(
    spec.map((entry) =>
      CheckMenuItem.new({
        id: entry.id,
        text: entry.text,
        checked: entry.checked,
        action: entry.action,
      }),
    ),
  );

  const menu = await Menu.new({ items });
  await menu.popup();
}
