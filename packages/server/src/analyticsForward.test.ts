import { Internal } from "@valbuild/core";
import {
  MAX_FORWARDED_BEACON_BYTES,
  forwardAnalyticsBeacon,
  prepareAnalyticsForward,
  visitorCountry,
} from "./analyticsForward";

/**
 * The parts of forwarding a self-hosted site's beacon that the route tests
 * (`analyticsRoute.test.ts`) cannot reach cheaply: a forward that hangs, and
 * a beacon over the ingest's size limit.
 */
describe("forwardAnalyticsBeacon", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const args = {
    ingestUrl: "https://ingest.test/__ingest/analytics",
    apiKey: "key",
    project: "acme/site",
    body: "{}",
    userAgent: "Mozilla/5.0",
    country: undefined,
  };

  test("a forward that takes too long is given up on, and does not throw", async () => {
    jest.spyOn(Internal.log, "debug").mockImplementation();
    let aborted = false;
    jest.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const started = Date.now();
    expect(await forwardAnalyticsBeacon({ ...args, timeoutMs: 20 })).toBe(null);
    expect(aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test("a forward that throws answers null", async () => {
    const debug = jest.spyOn(Internal.log, "debug").mockImplementation();
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"));
    expect(await forwardAnalyticsBeacon(args)).toBe(null);
    expect(debug).toHaveBeenCalled();
  });

  test("the ingest's status is what is answered", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("gone", { status: 410 }));
    expect(await forwardAnalyticsBeacon(args)).toBe(410);
  });
});

describe("prepareAnalyticsForward", () => {
  const visitor = {
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0",
  };

  test("a same-origin beacon with a User-Agent goes", () => {
    expect(prepareAnalyticsForward(visitor, "{}")).toEqual({
      ok: true,
      userAgent: "Mozilla/5.0",
      country: undefined,
    });
  });

  test("a beacon over the ingest's limit does not", () => {
    const body = "x".repeat(MAX_FORWARDED_BEACON_BYTES + 1);
    expect(prepareAnalyticsForward(visitor, body)).toEqual({
      ok: false,
      reason: "too-large",
    });
    // Bytes, not characters: the limit is the ingest's, in UTF-8.
    const wide = "ø".repeat(MAX_FORWARDED_BEACON_BYTES / 2 + 1);
    expect(prepareAnalyticsForward(visitor, wide)).toEqual({
      ok: false,
      reason: "too-large",
    });
  });
});

describe("visitorCountry", () => {
  test("takes the first header holding two letters, upper-cased", () => {
    expect(
      visitorCountry({
        "x-vercel-ip-country": "",
        "cf-ipcountry": "se",
        "cloudfront-viewer-country": "DK",
      }),
    ).toBe("SE");
  });

  test("nothing when no host said", () => {
    expect(visitorCountry({})).toBe(undefined);
  });
});
