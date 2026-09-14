/// <reference types="vite/client" />

declare const __INKRA_VERSION__: string;
declare const __INKRA_DMG_URL__: string;
declare const __INKRA_RELEASES_URL__: string;
declare const __INKRA_REPO_URL__: string;

/**
 * The desktop app's analytics variables, bridged by name in `vite.config.ts`
 * because they carry no `VITE_` prefix. `""` when unset.
 */
declare const __INKRA_POSTHOG_KEY__: string;
declare const __INKRA_POSTHOG_HOST__: string;

/**
 * The website's own analytics overrides, read at build time. Both are optional:
 * without either these or the `INKRA_*` pair above, the site sends nothing.
 * See `docs/website-analytics.md`.
 */
interface ImportMetaEnv {
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
}

declare module "*.css";
declare module "*.css?url" {
  const href: string;
  export default href;
}
