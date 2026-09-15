import { describe, expect, test } from "vitest";
import { DEFAULT_POSTHOG_HOST, resolveAnalyticsConfig } from "../src/analytics-config";

describe("resolveAnalyticsConfig", () => {
  test("no key means inert — nothing to initialize", () => {
    expect(resolveAnalyticsConfig({})).toBeNull();
    expect(resolveAnalyticsConfig({ VITE_POSTHOG_KEY: "" })).toBeNull();
    expect(resolveAnalyticsConfig({ VITE_POSTHOG_KEY: "   " })).toBeNull();
    // Both names blank, which is what an unbridged build passes in.
    expect(resolveAnalyticsConfig({ VITE_POSTHOG_KEY: "", INKRA_POSTHOG_KEY: "" })).toBeNull();
    // A host on its own is not enough: the key is what enables the client.
    expect(resolveAnalyticsConfig({ VITE_POSTHOG_HOST: "https://eu.i.posthog.com" })).toBeNull();
    expect(resolveAnalyticsConfig({ INKRA_POSTHOG_HOST: "https://eu.i.posthog.com" })).toBeNull();
  });

  test("a key alone resolves against the default host", () => {
    expect(resolveAnalyticsConfig({ VITE_POSTHOG_KEY: " phc_test " })).toEqual({
      key: "phc_test",
      host: DEFAULT_POSTHOG_HOST,
    });
  });

  test("the desktop app's key is the fallback, so one value configures both", () => {
    expect(resolveAnalyticsConfig({ INKRA_POSTHOG_KEY: " phc_shared " })).toEqual({
      key: "phc_shared",
      host: DEFAULT_POSTHOG_HOST,
    });
    expect(resolveAnalyticsConfig({ INKRA_POSTHOG_KEY: "  " })).toBeNull();
  });

  test("VITE_ wins over INKRA_, and a blank VITE_ defers rather than blocking", () => {
    expect(
      resolveAnalyticsConfig({ VITE_POSTHOG_KEY: "phc_site", INKRA_POSTHOG_KEY: "phc_shared" }),
    ).toEqual({ key: "phc_site", host: DEFAULT_POSTHOG_HOST });
    // The bridge passes "" for an unset INKRA_ variable and Vite leaves an
    // unset VITE_ one undefined; neither may shadow a key that is set.
    expect(
      resolveAnalyticsConfig({ VITE_POSTHOG_KEY: "  ", INKRA_POSTHOG_KEY: "phc_shared" }),
    ).toEqual({ key: "phc_shared", host: DEFAULT_POSTHOG_HOST });
  });

  test("the host follows the same order: VITE_, then INKRA_, then the default", () => {
    expect(
      resolveAnalyticsConfig({
        VITE_POSTHOG_KEY: "phc_test",
        VITE_POSTHOG_HOST: " https://eu.i.posthog.com ",
        INKRA_POSTHOG_HOST: "https://self.hosted.example",
      }),
    ).toEqual({ key: "phc_test", host: "https://eu.i.posthog.com" });
    expect(
      resolveAnalyticsConfig({
        VITE_POSTHOG_KEY: "phc_test",
        VITE_POSTHOG_HOST: "  ",
        INKRA_POSTHOG_HOST: " https://self.hosted.example ",
      }),
    ).toEqual({ key: "phc_test", host: "https://self.hosted.example" });
    expect(
      resolveAnalyticsConfig({ VITE_POSTHOG_KEY: "phc_test", VITE_POSTHOG_HOST: "  " }),
    ).toEqual({ key: "phc_test", host: DEFAULT_POSTHOG_HOST });
  });
});
