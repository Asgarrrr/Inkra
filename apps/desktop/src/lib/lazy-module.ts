/**
 * Wraps a dynamic `import()` so callers can ask whether the module is already
 * in memory (`peek`, synchronous) or wait for it (`load`).
 *
 * `load` deliberately drops the promise when the import rejects, so a later
 * call retries. Memoising the rejection instead would leave the feature dead
 * for the rest of the session with nothing on screen to say why.
 */
export function lazyModule<T>(load: () => Promise<T>) {
  let mod: T | undefined;
  let promise: Promise<T> | undefined;

  return {
    peek: (): T | undefined => mod,
    load: (): Promise<T> =>
      (promise ??= load().then(
        (m) => {
          mod = m;
          return m;
        },
        (err) => {
          promise = undefined;
          throw err;
        },
      )),
  };
}
