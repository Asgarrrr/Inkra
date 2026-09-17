/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to "1" at build time to keep startup instrumentation in a release build. */
  readonly VITE_STARTUP_METRICS?: string;
  /** Set to "1" at build time to keep keystroke instrumentation in a release build. */
  readonly VITE_KEYSTROKE_METRICS?: string;
}
