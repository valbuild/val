/**
 * @jest-environment node
 */
import { initVal, modules } from "@valbuild/core";

// initValRsc imports next/headers for its types, but the import is emitted, so
// it has to resolve at runtime. Nothing in the live path calls these.
jest.mock(
  "next/headers",
  () => ({
    cookies: () => {
      throw new Error("cookies() must not be called on the live path");
    },
    headers: () => {
      throw new Error("headers() must not be called on the live path");
    },
    draftMode: async () => ({ isEnabled: false }),
  }),
  { virtual: true },
);

import { initValRsc } from "./initValRsc";

const { s, c, config: baseConfig } = initVal({ project: "org/project" });

function fetchValFor(live?: { ttl: number; staleWhileRevalidate?: number }) {
  const config = { ...baseConfig, live };
  const valModule = c.define("/content/title.val.ts", s.string(), "Deployed");
  const valModules = modules(config, [
    { def: () => Promise.resolve({ default: valModule }) },
  ]);
  const { fetchValStega } = initValRsc(config, valModules, {
    draftMode: (async () => ({ isEnabled: false })) as never,
    headers: (() => {
      throw new Error("headers() must not be called on the live path");
    }) as never,
    cookies: (() => {
      throw new Error("cookies() must not be called on the live path");
    }) as never,
  });
  return { fetchValStega, valModule };
}

function liveResponse(value: string) {
  return {
    ok: true,
    status: 200,
    statusText: "",
    json: async () => ({
      headCommitSha: "commit2",
      baseCommitSha: "commit1",
      patches: [
        {
          patchId: "patch1",
          path: "/content/title.val.ts",
          patch: [{ op: "replace", path: [], value }],
          baseSha: "base1",
          createdAt: "2024-01-01T00:00:00.000Z",
          authorId: "author1",
          appliedAt: { commitSha: "commit2" },
        },
      ],
    }),
    headers: { get: () => null },
  } as unknown as Response;
}

/** Stega encodes paths as invisible unicode, so plain ascii means no markers. */
function hasStegaMarkers(value: string) {
  // eslint-disable-next-line no-control-regex
  return /[^\x00-\x7F]/.test(value);
}

describe("fetchValStega with live mode", () => {
  const env = { ...process.env };
  let fetchMock: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    process.env.VAL_API_KEY = "test-api-key";
    process.env.VAL_SECRET = "test-secret";
    process.env.VAL_GIT_COMMIT = "commit1";
    process.env.VAL_GIT_BRANCH = "main";
    delete process.env.VAL_LIVE_TTL;
    delete process.env.VAL_LIVE_DISABLED;
    fetchMock = jest.spyOn(global, "fetch");
    error = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...env };
    fetchMock.mockRestore();
    error.mockRestore();
  });

  test("renders committed-but-undeployed content for an anonymous visitor", async () => {
    fetchMock.mockResolvedValue(liveResponse("Committed"));
    const { fetchValStega, valModule } = fetchValFor({ ttl: 60 });

    expect(await fetchValStega(valModule)).toBe("Committed");
  });

  test("does not leak stega markers into public html", async () => {
    fetchMock.mockResolvedValue(liveResponse("Committed"));
    const { fetchValStega, valModule } = fetchValFor({ ttl: 60 });

    // `disabled` is bound to draft mode, not to live mode: live content is
    // public, so it must carry no data-val-path markers.
    expect(hasStegaMarkers(await fetchValStega(valModule))).toBe(false);
  });

  test("renders the deployed content when live mode is off", async () => {
    fetchMock.mockResolvedValue(liveResponse("Committed"));
    const { fetchValStega, valModule } = fetchValFor();

    expect(await fetchValStega(valModule)).toBe("Deployed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("VAL_LIVE_DISABLED falls back to the deployed content", async () => {
    process.env.VAL_LIVE_DISABLED = "true";
    fetchMock.mockResolvedValue(liveResponse("Committed"));
    const { fetchValStega, valModule } = fetchValFor({ ttl: 60 });

    expect(await fetchValStega(valModule)).toBe("Deployed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("falls back to the deployed content when Val is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const { fetchValStega, valModule } = fetchValFor({ ttl: 60 });

    const res = await fetchValStega(valModule);
    expect(res).toBe("Deployed");
    // A failure must not re-encode with stega enabled either.
    expect(hasStegaMarkers(res)).toBe(false);
  });

  test("a module with no live patch still renders the deployed content", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "",
      json: async () => ({
        headCommitSha: "commit2",
        baseCommitSha: "commit1",
        patches: [],
      }),
      headers: { get: () => null },
    } as unknown as Response);
    const { fetchValStega, valModule } = fetchValFor({ ttl: 60 });

    expect(await fetchValStega(valModule)).toBe("Deployed");
  });
});
