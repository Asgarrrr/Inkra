import { CommandGroup, CommandItem } from "cmdk";
import { getFileName } from "@/lib/paths";
import type { ContentSearchResult } from "@/types/fs";
import { contentParentDir, contentRowValue, type ContentSection } from "./group-content-results";
import { splitHighlightRanges } from "./highlight-ranges";

function HighlightedLine({
  text,
  ranges,
}: {
  text: string;
  ranges: readonly (readonly [number, number])[];
}) {
  return (
    <>
      {splitHighlightRanges(text, ranges).map((segment, i) => (
        <span key={i} className={segment.match ? "text-link font-semibold" : undefined}>
          {segment.text}
        </span>
      ))}
    </>
  );
}

export function ContentResults({
  section,
  onSelect,
}: {
  section: ContentSection;
  onSelect: (result: ContentSearchResult) => void;
}) {
  if (section.kind === "idle" || section.kind === "pending") return null;

  if (section.kind !== "active") {
    return (
      <CommandGroup heading="In documents">
        <div className="px-3 py-2 text-[13px] text-text-muted">
          {section.kind === "empty"
            ? "No matches in documents."
            : "Could not search documents right now."}
        </div>
      </CommandGroup>
    );
  }

  return (
    <CommandGroup heading="In documents">
      {section.groups.map((group) => {
        const parentDir = contentParentDir(group.relativePath);
        return (
          <div key={group.path}>
            <div className="flex min-w-0 items-baseline gap-2 px-3 pt-2 pb-1">
              <span className="truncate text-[13px] text-text-secondary">
                {getFileName(group.path)}
              </span>
              {parentDir && (
                <span className="truncate text-[11px] text-text-muted">{parentDir}</span>
              )}
            </div>
            {group.results.map((result) => (
              <CommandItem
                key={contentRowValue(result)}
                value={contentRowValue(result)}
                onSelect={() => onSelect(result)}
              >
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 text-[11px] text-text-muted tabular-nums">
                    {result.line_number}
                  </span>
                  <span className="truncate">
                    <HighlightedLine text={result.line_content} ranges={result.match_ranges} />
                    {result.line_truncated && <span className="text-text-muted">…</span>}
                  </span>
                </div>
              </CommandItem>
            ))}
          </div>
        );
      })}
      {section.searching && <div className="px-3 py-2 text-[13px] text-text-muted">Searching…</div>}
      {section.truncated && (
        <div className="px-3 py-2 text-[13px] text-text-muted">
          Too many matches — showing the first ones only.
        </div>
      )}
    </CommandGroup>
  );
}
