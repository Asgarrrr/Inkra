import { useEffect, useMemo, useRef, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "cmdk";
import type { SearchResult } from "@/types/fs";
import {
  useCloseCommandPalette,
  useCommandPaletteIntent,
  useCommandPaletteSearch,
  useIsCommandPaletteOpen,
  useOpenCommandPalette,
  useSetCommandPaletteSearch,
} from "@/hooks/use-command-palette";
import { useSidebar } from "@/hooks/use-sidebar";
import { useCloseWorkspace, useIsCompactFileMode, useWorkspace } from "@/hooks/use-workspace";
import {
  useActiveFilePath,
  useActiveTabId,
  useCloseActiveTab,
  useCloseTab,
  useOpenFile,
  useOpenSettingsTab,
  useOpenTabs,
} from "@/hooks/use-tabs";
import { useTheme } from "@/hooks/use-theme";
import { useFuzzySearch } from "./use-fuzzy-search";
import { useContentSearch } from "./use-content-search";
import { ContentResults } from "./content-results";
import { contentRowValue, contentSearchQuery, contentSection } from "./group-content-results";
import { useGlobalRecentFiles } from "@/hooks/use-global-recent-files";
import { openStandaloneFile } from "@/hooks/use-open-drop";
import { settingsKind } from "@/components/editor-area/page-kinds/settings";
import { getFileName, getFileStem, getParentDir } from "@/lib/paths";
import * as tauri from "@/lib/tauri";
import type { RecentFile } from "@/lib/tauri";

function toCreatePath(root: string, rawName: string) {
  const trimmed = rawName.trim();
  const fileName = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
  return `${root}/${fileName}`;
}

function matchesSearch(text: string, q: string) {
  return text.toLowerCase().includes(q.toLowerCase());
}

function HighlightedPath({ path, indices }: { path: string; indices: number[] }) {
  const set = new Set(indices);
  return (
    <span>
      {Array.from(path).map((char, i) => (
        <span key={i} className={set.has(i) ? "text-link font-semibold" : undefined}>
          {char}
        </span>
      ))}
    </span>
  );
}

export function CommandPalette() {
  const isOpen = useIsCommandPaletteOpen();
  const close = useCloseCommandPalette();
  const openCommandPalette = useOpenCommandPalette();
  const intent = useCommandPaletteIntent();
  const search = useCommandPaletteSearch();
  const setSearch = useSetCommandPaletteSearch();
  const { toggleSidebar } = useSidebar();
  const { root, isIndexing, openWorkspace } = useWorkspace();
  const closeWorkspace = useCloseWorkspace();
  const openFile = useOpenFile();
  const closeActiveTab = useCloseActiveTab();
  const closeTab = useCloseTab();
  const activeTabId = useActiveTabId();
  const activeFilePath = useActiveFilePath();
  const tabs = useOpenTabs();
  const { toggleTheme } = useTheme();
  const openSettingsTab = useOpenSettingsTab();
  const isCompactFileMode = useIsCompactFileMode();

  const isCreateIntent = intent === "create-file";
  const trimmedSearch = search.trim();
  const fileQuery = isCreateIntent ? "" : search;
  // Standalone compact windows have no workspace index — search filters the
  // global recents list client-side instead of hitting fuzzy_search.
  const results = useFuzzySearch(isCompactFileMode ? "" : fileQuery);
  // Without a workspace the scan can only reject with `NoWorkspace`, once per
  // debounce, and the palette would report the failure as "no matches".
  const contentQuery = isCreateIntent || !root ? "" : contentSearchQuery(search);
  const content = useContentSearch(contentQuery);
  const { files: globalRecents } = useGlobalRecentFiles(30, isOpen && isCompactFileMode);
  // In standalone mode new files are created next to the active file.
  const createBaseDir = root ?? (activeFilePath ? getParentDir(activeFilePath) : null);
  const createPath =
    createBaseDir && trimmedSearch ? toCreatePath(createBaseDir, trimmedSearch) : null;

  function handleSelect(path: string) {
    void (isCompactFileMode ? openStandaloneFile(path) : openFile(path));
    close();
  }

  function handleCreate() {
    if (!createPath) return;

    close();
    void (async () => {
      await tauri.createFile(createPath);
      if (isCompactFileMode) {
        await openStandaloneFile(createPath);
      } else {
        await openFile(createPath);
      }
    })();
  }

  async function handleOpenWorkspace() {
    const picked = await tauri.pickWorkspace();
    if (picked) {
      // Standalone compact windows stay pure — workspaces open elsewhere.
      if (isCompactFileMode) {
        await tauri.openWorkspaceInNewWindow(picked);
      } else {
        await openWorkspace(picked);
      }
    }
    close();
  }

  type Command = { id: string; label: string; description: string; run: () => void };

  const commands: Command[] = [
    root &&
      !isCompactFileMode && {
        id: "toggle-sidebar",
        label: "Toggle Sidebar",
        description: "Command",
        run: () => {
          toggleSidebar();
          close();
        },
      },
    (root || (isCompactFileMode && activeFilePath)) && {
      id: "new-file",
      label: "Create New File",
      description: "Command",
      run: () => openCommandPalette("create-file"),
    },
    root &&
      activeFilePath && {
        id: "open-in-compact-window",
        label: "Open File in Compact Window",
        description: "Command",
        run: () => {
          void tauri.openFileInStandaloneWindow(activeFilePath);
          close();
        },
      },
    activeTabId &&
      !isCompactFileMode && {
        id: "close-tab",
        label: "Close Current Tab",
        description: "Command",
        run: () => {
          closeActiveTab();
          close();
        },
      },
    tabs.length > 0 &&
      !isCompactFileMode && {
        id: "close-all",
        label: "Close All Tabs",
        description: "Command",
        run: () => {
          for (const tab of tabs) closeTab(tab.id);
          close();
        },
      },
    {
      id: "open-workspace",
      label: "Open Workspace",
      description: "Command",
      run: () => void handleOpenWorkspace(),
    },
    root && {
      id: "close-workspace",
      label: "Close Workspace",
      description: "Command",
      run: () => {
        closeWorkspace();
        close();
      },
    },
    {
      id: "toggle-theme",
      label: "Toggle Dark Mode",
      description: "Command",
      run: () => {
        toggleTheme();
        close();
      },
    },
    !isCompactFileMode && {
      id: "open-settings",
      label: "Settings",
      description: settingsKind.description,
      run: () => {
        openSettingsTab();
        close();
      },
    },
  ].filter((c): c is Command => Boolean(c));

  const visibleFiles: SearchResult[] =
    !isCreateIntent && trimmedSearch && !isCompactFileMode ? results : [];
  const visibleRecents: RecentFile[] =
    !isCreateIntent && isCompactFileMode && trimmedSearch
      ? globalRecents.filter(
          (entry) =>
            matchesSearch(entry.title ?? "", trimmedSearch) ||
            matchesSearch(entry.name, trimmedSearch) ||
            matchesSearch(entry.path, trimmedSearch),
        )
      : [];
  const visibleCommands = isCreateIntent
    ? []
    : trimmedSearch
      ? commands.filter((c) => matchesSearch(c.label, trimmedSearch))
      : commands;
  const section = useMemo(
    () =>
      contentSection({
        query: contentQuery,
        session: content.session,
        isSearching: content.isSearching,
        isStale: content.isStale,
      }),
    [contentQuery, content],
  );
  const firstContentRow = section.kind === "active" ? section.groups[0]?.results[0] : undefined;
  const firstValue =
    visibleCommands[0]?.id ??
    visibleFiles[0]?.path ??
    visibleRecents[0]?.path ??
    (firstContentRow ? contentRowValue(firstContentRow) : "");

  const rowValues = new Set<string>();
  for (const command of visibleCommands) rowValues.add(command.id);
  for (const file of visibleFiles) rowValues.add(file.path);
  for (const entry of visibleRecents) rowValues.add(entry.path);
  if (section.kind === "active") {
    for (const group of section.groups) {
      for (const result of group.results) rowValues.add(contentRowValue(result));
    }
  }

  const listRef = useRef<HTMLDivElement>(null);
  const [selectedValue, setSelectedValue] = useState(firstValue);
  const snapKey = `${intent} ${search}`;
  const lastSnapKey = useRef(snapKey);
  const isSelectionOnScreen = rowValues.has(selectedValue);

  // Content batches stream in out of score order, so the first row moves while
  // the user is already looking at the list. cmdk keys its selection on
  // `value`, so leaving the selection alone through a re-sort keeps it on the
  // same row; snapping on every shift of `firstValue` would move it under the
  // user's Enter. Snap only when the query changes or the selection is gone.
  // selectedValue is also set by cmdk onValueChange (keyboard nav) and this effect also scrolls the list — not pure derived state.
  /* eslint-disable react-doctor/no-derived-state */
  useEffect(() => {
    if (lastSnapKey.current === snapKey && isSelectionOnScreen) return;
    lastSnapKey.current = snapKey;
    setSelectedValue(firstValue);
    listRef.current?.scrollTo({ top: 0 });
  }, [snapKey, isSelectionOnScreen, firstValue]);
  /* eslint-enable react-doctor/no-derived-state */

  const placeholder = isCreateIntent ? "Create a new note..." : "Search...";
  const hasRows =
    visibleCommands.length > 0 || visibleFiles.length > 0 || visibleRecents.length > 0;
  const isIndexingSearch = isIndexing && !isCompactFileMode && trimmedSearch !== "";
  // The list is never at once empty of rows and empty of messages, and a
  // message never states a verdict a scan has not reached.
  const emptyMessage = isIndexingSearch
    ? "Indexing workspace..."
    : section.kind === "pending"
      ? "Searching documents..."
      : "No results found.";

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      label="Command Palette"
      shouldFilter={false}
      value={selectedValue}
      onValueChange={setSelectedValue}
    >
      <CommandInput placeholder={placeholder} value={search} onValueChange={setSearch} />
      <CommandList ref={listRef}>
        {isCreateIntent ? (
          <>
            {!trimmedSearch && <CommandEmpty>Type a note name to create it.</CommandEmpty>}
            {createPath && (
              <CommandGroup heading="Create note">
                <CommandItem value={createPath} onSelect={handleCreate}>
                  Create: {getFileName(createPath)}
                </CommandItem>
              </CommandGroup>
            )}
          </>
        ) : (
          <>
            {isIndexingSearch && hasRows && (
              <div className="px-3 py-2 text-[13px] text-text-muted">Indexing workspace...</div>
            )}

            {!hasRows && (section.kind === "idle" || section.kind === "pending") && (
              <CommandEmpty>{emptyMessage}</CommandEmpty>
            )}

            {visibleCommands.length > 0 && (
              <CommandGroup heading="Commands">
                {visibleCommands.map((c) => (
                  <CommandItem key={c.id} value={c.id} onSelect={c.run}>
                    <div className="flex flex-col">
                      <span>{c.label}</span>
                      <span className="text-[13px] text-text-muted">{c.description}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {(visibleFiles.length > 0 || visibleRecents.length > 0) && (
              <CommandGroup heading="Files">
                {visibleFiles.map((r) => (
                  <CommandItem key={r.path} value={r.path} onSelect={() => handleSelect(r.path)}>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{getFileName(r.path)}</span>
                      <span className="truncate text-[13px] text-text-muted">
                        <HighlightedPath path={r.relative_path} indices={r.match_indices} />
                      </span>
                    </div>
                  </CommandItem>
                ))}

                {visibleRecents.map((entry) => (
                  <CommandItem
                    key={entry.path}
                    value={entry.path}
                    onSelect={() => handleSelect(entry.path)}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{entry.title || getFileStem(entry.name)}</span>
                      <span className="truncate text-[13px] text-text-muted">
                        {getParentDir(entry.path)}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            <ContentResults section={section} onSelect={handleSelect} />
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
