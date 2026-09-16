import { useEffect } from "react";
import { AppLayout } from "./components/app-layout";
import { CommandPalette } from "./components/command-palette";
import { TelemetryConsentDialog } from "./components/telemetry-consent-dialog";
import { WindowTitle } from "./components/window-title";
import { useIsStartupResolved } from "./hooks/use-workspace";
import { useFileWatcher } from "./hooks/use-file-watcher";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useMenuEvents } from "./hooks/use-menu-events";
import { useOpenDrop } from "./hooks/use-open-drop";
import { mark } from "./lib/startup-metrics";
import "./lib/global-recents";
import "./lib/standalone-watch";
import "./App.css";

function App() {
  // `mark` keeps only the first call for a name, so marking on every render is
  // safe and records the first one.
  mark("app-render");
  const isStartupResolved = useIsStartupResolved();

  // Declared before the other hooks so its effect runs before theirs. The gap
  // from here to `resolve-start` is what the three hooks below cost on mount;
  // the gap from `app-render` to here is React's own render and commit.
  useEffect(() => {
    mark("app-effects");
  }, []);

  useFileWatcher();
  useKeyboardShortcuts();
  useMenuEvents();
  useOpenDrop();

  if (!isStartupResolved) {
    return null;
  }

  return (
    <>
      <WindowTitle />
      <AppLayout />
      <CommandPalette />
      <TelemetryConsentDialog />
    </>
  );
}

export default App;
