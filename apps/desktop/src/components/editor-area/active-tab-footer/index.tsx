import { useActiveTab } from "@/hooks/use-tabs";
import { pageKindView } from "../page-kinds/views";

/**
 * The active tab's footer chrome, if its page kind registers one. Rendered by
 * each layout beside `EditorArea` rather than inside it, so a layout that
 * wants no footer — the compact window — simply leaves it out.
 *
 * Positions itself `absolute bottom-0` against the nearest positioned
 * ancestor, which is the layout's editor column.
 */
export function ActiveTabFooter() {
  const activeTab = useActiveTab();
  if (!activeTab) return null;

  const Footer = pageKindView(activeTab.location).Footer;
  if (!Footer) return null;

  return <Footer location={activeTab.location} />;
}
