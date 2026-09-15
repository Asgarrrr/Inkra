/** Minimal hooks runtime so a real hook module can be executed under
 *  `environment: "node"`, where there is no DOM to render into. Mock it over
 *  `react` with `vi.mock("react", () => import("./helpers/fake-react"))`.
 *  One hook instance at a time. */

type Slot = { value?: unknown; deps?: unknown[]; cleanup?: (() => void) | void };

let slots: Slot[] = [];
let cursor = 0;
let pending: Array<() => void> = [];
let schedule: (() => void) | null = null;

function slot(): Slot {
  return (slots[cursor++] ??= {});
}

function changed(previous: unknown[] | undefined, next: unknown[] | undefined): boolean {
  return (
    !previous ||
    !next ||
    previous.length !== next.length ||
    next.some((dep, i) => !Object.is(dep, previous[i]))
  );
}

export function useState<T>(initial: T | (() => T)) {
  const state = slot();
  state.value ??= typeof initial === "function" ? (initial as () => T)() : initial;
  const set = (next: T | ((previous: T) => T)) => {
    const value = typeof next === "function" ? (next as (p: T) => T)(state.value as T) : next;
    if (Object.is(value, state.value)) return;
    state.value = value;
    schedule?.();
  };
  return [state.value as T, set] as const;
}

export function useRef<T>(initial: T) {
  const state = slot();
  state.value ??= { current: initial };
  return state.value as { current: T };
}

export function useMemo<T>(factory: () => T, deps: unknown[]): T {
  const state = slot();
  if (changed(state.deps, deps)) {
    state.deps = deps;
    state.value = factory();
  }
  return state.value as T;
}

export function useEffect(effect: () => (() => void) | void, deps?: unknown[]) {
  const state = slot();
  if (!changed(state.deps, deps)) return;
  pending.push(() => {
    if (state.cleanup) state.cleanup();
    state.deps = deps;
    state.cleanup = effect();
  });
}

/** `strictMode` reproduces React's mount-time setup → cleanup → setup. */
export function renderHook<P, R>(hook: (props: P) => R, props: NoInfer<P>, strictMode = false) {
  slots = [];
  pending = [];
  let current = props;
  let result!: R;
  let renders = 0;
  let mounted = false;

  const run = () => {
    cursor = 0;
    renders += 1;
    result = hook(current);
    const effects = pending.splice(0);
    for (const effect of effects) effect();
    if (strictMode && !mounted) {
      for (const state of slots) {
        state.cleanup?.();
        state.cleanup = undefined;
      }
      for (const effect of effects) effect();
    }
    mounted = true;
  };

  schedule = run;
  run();

  return {
    get result() {
      return result;
    },
    get renders() {
      return renders;
    },
    rerender(next: P) {
      current = next;
      run();
    },
    unmount() {
      schedule = null;
      for (const state of slots) state.cleanup?.();
      slots = [];
    },
  };
}
