import { type Mock, vi } from "bun:test";

/** The five Vitest APIs `bun:test`'s `vi` object does not carry. Everything
 *  else the suite uses comes straight from `bun:test`. */

type Mocked<T> = T extends (...args: infer Args) => infer Result
  ? Mock<(...args: Args) => Result> & T
  : T extends object
    ? { [Key in keyof T]: Mocked<T[Key]> }
    : T;

/** Pure type assertion, exactly like `vi.mocked`: the value already *is* the
 *  mock installed by `vi.mock`, but its declared type is the real module's. */
export function mocked<T>(item: T): Mocked<T> {
  return item as Mocked<T>;
}

const globalStubs = new Map<string, PropertyDescriptor | undefined>();

/** Records the property's original descriptor — including its absence — so
 *  `unstubAllGlobals` can put `globalThis` back exactly as it was. */
export function stubGlobal(name: string, value: unknown): void {
  if (!globalStubs.has(name)) {
    globalStubs.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }

  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

export function unstubAllGlobals(): void {
  for (const [name, descriptor] of globalStubs) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete (globalThis as Record<string, unknown>)[name];
    }
  }

  globalStubs.clear();
}

/** Polls `callback` until it stops throwing, then returns its value. */
export async function waitFor<T>(
  callback: () => T | Promise<T>,
  { timeout = 1000, interval = 50 }: { timeout?: number; interval?: number } = {},
): Promise<T> {
  requireRealTimers("waitFor");

  let lastError: unknown;
  let expired = false;
  let deadline!: ReturnType<typeof setTimeout>;

  /** Raced against every await rather than checked between attempts: a
   *  callback that never settles leaves a between-attempts check unreachable,
   *  and the test dies on bun's 5s kill naming nothing. Rejecting with
   *  `lastError` keeps the reported failure the assertion that kept failing,
   *  not the timeout that ended the wait. */
  const expiry = new Promise<never>((_, reject) => {
    deadline = setTimeout(() => {
      expired = true;
      reject(lastError ?? new Error(`waitFor: no attempt settled within ${timeout}ms`));
    }, timeout);
  });

  try {
    for (;;) {
      try {
        return await Promise.race([Promise.resolve(callback()), expiry]);
      } catch (error) {
        if (expired) throw error;
        lastError = error;
      }

      await Promise.race([sleep(interval), expiry]);
    }
  } finally {
    clearTimeout(deadline);
  }
}

/** The async timer variants only differ from the synchronous ones by letting
 *  the promise callbacks the fired timers queued settle before returning. */
export async function runOnlyPendingTimersAsync(): Promise<void> {
  requireFakeTimers("runOnlyPendingTimersAsync");
  vi.runOnlyPendingTimers();
  await flushMicrotasks();
}

export async function advanceTimersByTimeAsync(ms: number): Promise<void> {
  requireFakeTimers("advanceTimersByTimeAsync");
  vi.advanceTimersByTime(ms);
  await flushMicrotasks();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A fake clock advances only when a test advances it, so `waitFor`'s polling
 *  sleep never resolves under one and the wait hangs instead of failing. */
function requireRealTimers(name: string): void {
  if (vi.isFakeTimers()) {
    throw new Error(`${name} polls on a real timer: call vi.useRealTimers() before it.`);
  }
}

function requireFakeTimers(name: string): void {
  if (!vi.isFakeTimers()) {
    throw new Error(`${name} drives the fake clock: call vi.useFakeTimers() before it.`);
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
