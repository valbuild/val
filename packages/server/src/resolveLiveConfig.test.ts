import { ValConfig } from "@valbuild/core";
import { resolveLiveConfig } from "./ValRouter";

describe("resolveLiveConfig", () => {
  const envKeys = [
    "VAL_LIVE_TTL",
    "VAL_LIVE_STALE_WHILE_REVALIDATE",
    "VAL_LIVE_DISABLED",
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};
  let warn: jest.SpyInstance;

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    warn.mockRestore();
  });

  test("live mode is off when 'live' is not configured", () => {
    expect(resolveLiveConfig({}, true)).toBeUndefined();
  });

  test("tolerates an undefined config", () => {
    // initVal() hands back whatever it was given, so apps that call it without
    // arguments end up with an undefined config at runtime.
    expect(resolveLiveConfig(undefined, true)).toBeUndefined();
  });

  test("ttl is carried through and staleWhileRevalidate defaults to 0", () => {
    expect(resolveLiveConfig({ live: { ttl: 60 } }, true)).toEqual({
      ttl: 60,
      staleWhileRevalidate: 0,
    });
  });

  test("ttl: 0 is allowed and means always refetch", () => {
    expect(resolveLiveConfig({ live: { ttl: 0 } }, true)).toEqual({
      ttl: 0,
      staleWhileRevalidate: 0,
    });
  });

  test("staleWhileRevalidate is carried through", () => {
    expect(
      resolveLiveConfig({ live: { ttl: 60, staleWhileRevalidate: 300 } }, true),
    ).toEqual({ ttl: 60, staleWhileRevalidate: 300 });
  });

  test("env vars override val.config", () => {
    process.env.VAL_LIVE_TTL = "10";
    process.env.VAL_LIVE_STALE_WHILE_REVALIDATE = "20";
    expect(
      resolveLiveConfig({ live: { ttl: 60, staleWhileRevalidate: 300 } }, true),
    ).toEqual({ ttl: 10, staleWhileRevalidate: 20 });
  });

  test("VAL_LIVE_TTL enables live mode without a val.config block", () => {
    process.env.VAL_LIVE_TTL = "30";
    expect(resolveLiveConfig({}, true)).toEqual({
      ttl: 30,
      staleWhileRevalidate: 0,
    });
  });

  test("VAL_LIVE_DISABLED=true is a kill switch", () => {
    process.env.VAL_LIVE_TTL = "30";
    process.env.VAL_LIVE_DISABLED = "true";
    expect(resolveLiveConfig({ live: { ttl: 60 } }, true)).toBeUndefined();
  });

  test("live mode is a no-op in fs mode, with a warning", () => {
    expect(resolveLiveConfig({ live: { ttl: 60 } }, false)).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  test("throws when 'live' is set without a ttl", () => {
    // The ValConfig type requires ttl, but val.config may be plain JS
    const config = { live: {} } as unknown as ValConfig;
    expect(() => resolveLiveConfig(config, true)).toThrow(
      /live\.ttl.*required/,
    );
  });

  test.each([
    ["a negative ttl", { live: { ttl: -1 } }],
    ["a non-finite ttl", { live: { ttl: Infinity } }],
    ["a non-numeric ttl", { live: { ttl: "60" } }],
    ["a negative staleWhileRevalidate", { live: { ttl: 1, swr: -1 } }],
  ])("throws on %s", (_name, live) => {
    const config = {
      live: {
        ttl: (live.live as { ttl: unknown }).ttl,
        staleWhileRevalidate: (live.live as { swr?: unknown }).swr,
      },
    } as unknown as ValConfig;
    expect(() => resolveLiveConfig(config, true)).toThrow(
      /Invalid Val live mode config/,
    );
  });

  test("throws on an invalid VAL_LIVE_TTL env var", () => {
    process.env.VAL_LIVE_TTL = "not-a-number";
    expect(() => resolveLiveConfig({}, true)).toThrow(/VAL_LIVE_TTL/);
  });
});
