// Carries a jump target across the gap between `navigateToFile` (which
// triggers an async load + an editor swap) and the editor's first render
// of the new document. Keyed by absolute file path. Consumed exactly once:
// a target left behind fires on an unrelated later navigation.

export type PendingTarget = { kind: "heading"; slug: string } | { kind: "line"; line: number };

const pending = new Map<string, PendingTarget>();

export function setPendingTarget(path: string, target: PendingTarget): void {
  pending.set(path, target);
}

export function consumePendingTarget(path: string): PendingTarget | undefined {
  const target = pending.get(path);
  if (target !== undefined) pending.delete(path);
  return target;
}

// A path that goes away — renamed, deleted, or left behind by a workspace
// switch — takes its target with it. Otherwise the entry outlives every editor
// that could consume it, and fires if that path is ever recreated.

export function clearPendingTarget(path: string): void {
  pending.delete(path);
}

export function clearAllPendingTargets(): void {
  pending.clear();
}
