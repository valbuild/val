import { initVal, modules } from "@valbuild/core";
import { createValApiRouter, createValServer } from "./ValRouter";
import { encodeJwt } from "./jwt";
import { fakeRequest } from "./fakeRequest";
import type { CommitContext, CommitResult } from "./ValServer";

/**
 * `publishOverride`: what a publish DOES when the content service holds the
 * patches.
 *
 * The seam exists because "publish" is not one thing. Val's default in http
 * mode is a git commit — the repository is the record. A host that publishes by
 * BUILDING has a different record, and a third that wants both has a third
 * answer. So the override is handed the default as `commitToGit` rather than
 * having it silently skipped, and the two directions below are the whole point:
 * calling it must still commit, and not calling it must not.
 *
 * A test that only checked "the override runs" would pass with `commitToGit`
 * hard-wired to run before it, which is exactly the design this rejects.
 */

const VAL_SECRET = "test-secret-at-least-32-chars-long!!";
const API_KEY = "test-api-key";

function setup(publishOverride?: (c: CommitContext) => Promise<CommitResult>) {
  // `initVal()` with no argument returns `config: undefined`, and the publish
  // path reads `options.config.files?.directory`.
  const { c, s, config } = initVal({ project: "acme/site" });
  const route = "/api/val";
  const commitCalls: string[] = [];
  const originalFetch = global.fetch;

  global.fetch = (async (url: string | URL) => {
    const href = String(url);
    if (href.endsWith("/commit")) {
      commitCalls.push(href);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          updatedFiles: [],
          commit: "new-commit-sha",
          branch: "main",
        }),
        text: async () => "",
      };
    }
    // Everything else the publish path touches: an empty patch chain.
    const body = { patches: [], commits: [] };
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }) as unknown as typeof fetch;

  const handler = createValApiRouter(
    route,
    createValServer(
      modules(config, [
        {
          def: () =>
            Promise.resolve({
              default: c.define("/content/page.val.ts", s.string(), "hello"),
            }),
        },
      ]),
      route,
      {
        // Everything `initHandlerOptions` needs to choose http mode.
        mode: "proxy",
        apiKey: API_KEY,
        valSecret: VAL_SECRET,
        gitCommit: "commit-sha",
        gitBranch: "main",
        project: "acme/site",
        disableCache: true,
        versions: { core: "1.0.0", next: "1.0.0" },
      },
      config,
      {
        async isEnabled() {
          return true;
        },
        async onDisable() {},
        async onEnable() {},
      },
      undefined,
      undefined,
      publishOverride,
    ),
    (res) => res,
  );
  return {
    handler,
    commitCalls,
    restore: () => {
      global.fetch = originalFetch;
    },
  };
}

/** A session, since http mode has no anonymous publish. */
const session = encodeJwt(
  {
    sub: "author-1",
    exp: Math.floor(Date.now() / 1000) + 3600,
    // Required by IntegratedServerJwtPayload: the app token the session wraps.
    token: "content-api-token",
    org: "acme",
    project: "acme/site",
  },
  VAL_SECRET,
);

const save = (handler: ReturnType<typeof setup>["handler"]) =>
  handler(
    fakeRequest({
      method: "POST",
      url: new URL("http://localhost/api/val/save"),
      /*
       * Percent-encoded, as a browser sends it.
       *
       * `getCookies` reads a value with `cookie.split("=")[1]`, which works
       * only because `serializeCookie` encodes what it sets -- a JWT is padded
       * base64 and a raw one would be truncated at its first `=`, failing
       * signature verification with a 401 that says nothing about cookies.
       */
      headers: new Headers({
        Cookie: `val_session=${encodeURIComponent(session)}`,
      }),
      json: { patchIds: [] },
    }),
  );

describe("publishOverride", () => {
  test("without one, a publish commits to git", async () => {
    const { handler, commitCalls, restore } = setup();
    try {
      await save(handler);
      expect(commitCalls.length).toBe(1);
    } finally {
      restore();
    }
  });

  test("an override that does NOT call commitToGit replaces the commit", async () => {
    // The direction that matters for a host whose publish is a build: nothing
    // may reach the repository behind its back.
    const seen: CommitContext[] = [];
    const { handler, commitCalls, restore } = setup(async (context) => {
      seen.push(context);
      return { updatedFiles: [], commit: "built" as never, branch: "main" };
    });
    try {
      await save(handler);
      expect(seen.length).toBe(1);
      expect(commitCalls.length).toBe(0);
    } finally {
      restore();
    }
  });

  test("an override that DOES call commitToGit still commits", async () => {
    // The other direction, for "publish to the repo AND build".
    const { handler, commitCalls, restore } = setup(async (context) =>
      context.commitToGit(),
    );
    try {
      await save(handler);
      expect(commitCalls.length).toBe(1);
    } finally {
      restore();
    }
  });
});
