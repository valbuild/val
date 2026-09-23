import type { PublishArtifact } from "@valbuild/tanstack-build";
import type { DeclareBody } from "@valbuild/shared/internal";
import { StudioPublishClient, StudioUploadError } from "./publishClient";
import { PublishPhase, runStudioPublish } from "./runStudioPublish";

/**
 * The publish conversation, driven from the tab.
 *
 * What these pin is not the happy path -- that is one call each way -- but the
 * three places where being wrong is expensive: a slot that expired mid-upload,
 * content asking for an artifact this build does not have, and every exit being
 * a value rather than a throw. The last one matters because this runs behind a
 * React handler: a rejection at an await boundary is a spinner nobody can stop.
 */

const artifact = (key: string, body = "x"): PublishArtifact => ({
  key,
  body,
  sha256: "sha",
  bytes: body.length,
});

const slot = (key: string) => ({
  key,
  url: `https://storage.test/${key}`,
  method: "PUT" as const,
  headers: {},
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
});

const declareBody: DeclareBody = {
  buildHash: "hash",
  commit: "commit",
  branch: "main",
  layerRev: "rev",
  linksOwnCss: false,
  artifacts: [],
};

function client(overrides: Partial<StudioPublishClient>): StudioPublishClient {
  return {
    declare: async () => ({
      publishId: "pub_1",
      state: "awaiting-artifacts",
      project: { publicProjectId: "p", siteUrl: "https://site.test" },
      uploads: [],
      have: [],
    }),
    confirmArtifacts: async () => ({
      publishId: "pub_1",
      state: "ready",
      problems: [],
    }),
    verify: async () => ({
      publishId: "pub_1",
      state: "verified",
      ok: true,
      problems: [],
      previewUrl: null,
    }),
    promote: async () => ({
      publishId: "pub_1",
      state: "live",
      url: "https://site.test",
      commit: "commit",
    }),
    status: async () => ({
      publishId: "pub_1",
      state: "live",
      problems: [],
    }),
    upload: async () => undefined,
    ...overrides,
  } as StudioPublishClient;
}

const run = (c: StudioPublishClient, artifacts: PublishArtifact[] = []) => {
  const phases: PublishPhase[] = [];
  return runStudioPublish({
    client: c,
    artifacts,
    declare: declareBody,
    onPhase: (phase) => phases.push(phase),
  }).then((result) => ({ result, phases }));
};

describe("a publish that works", () => {
  test("uploads what content asked for and ends live", async () => {
    const uploaded: string[] = [];
    const { result, phases } = await run(
      client({
        declare: async () => ({
          publishId: "pub_1",
          state: "awaiting-artifacts",
          project: { publicProjectId: "p", siteUrl: "https://site.test" },
          uploads: [slot("server"), slot("client")],
          have: ["css"],
        }),
        upload: async (s) => {
          uploaded.push(s.key);
        },
      }),
      [artifact("server"), artifact("client"), artifact("css")],
    );
    expect(result).toEqual({
      status: "live",
      publishId: "pub_1",
      url: "https://site.test",
    });
    // Only what content did not already hold. `css` was in `have`.
    expect(uploaded).toEqual(["server", "client"]);
    expect(phases.map((p) => p.kind)).toEqual([
      "declaring",
      "uploading",
      "uploading",
      "uploading",
      "confirming",
      "verifying",
      "promoting",
    ]);
  });

  test("a build content already serves is a success, not a retry", async () => {
    /*
     * Re-declaring would mint slots to overwrite the bytes of a LIVE site. A
     * second publish of an unchanged build lands here, and so does a retry
     * after a lost response.
     */
    const { result } = await run(
      client({
        declare: async () => ({
          publishId: "pub_1",
          state: "live",
          project: { publicProjectId: "p", siteUrl: "https://site.test" },
          uploads: [],
          have: [],
        }),
      }),
    );
    expect(result.status).toBe("already-live");
  });
});

describe("a slot that expired while it was being used", () => {
  test("is declared again rather than failing the publish", async () => {
    // The hour ran out mid-upload. Nothing has failed: fresh slots are one
    // more declare away, and giving up here loses an upload short of the line.
    let round = 0;
    const attempts: string[] = [];
    const { result } = await run(
      client({
        declare: async () => {
          round += 1;
          return {
            publishId: "pub_1",
            state: "awaiting-artifacts",
            project: { publicProjectId: "p", siteUrl: null },
            uploads: [slot("server")],
            have: [],
          };
        },
        upload: async (s) => {
          attempts.push(`${round}:${s.key}`);
          if (round === 1) {
            throw new StudioUploadError(403, s.key, "expired");
          }
        },
      }),
      [artifact("server")],
    );
    expect(result.status).toBe("live");
    expect(attempts).toEqual(["1:server", "2:server"]);
  });

  test("but a storage refusal that is not expiry fails the publish", async () => {
    const { result } = await run(
      client({
        declare: async () => ({
          publishId: "pub_1",
          state: "awaiting-artifacts",
          project: { publicProjectId: "p", siteUrl: null },
          uploads: [slot("server")],
          have: [],
        }),
        upload: async (s) => {
          throw new StudioUploadError(500, s.key, "storage is down");
        },
      }),
      [artifact("server")],
    );
    expect(result.status).toBe("failed");
    expect("message" in result && result.message).toContain("storage is down");
  });
});

describe("the two ends disagreeing about the namespace", () => {
  test("an artifact this build never produced is reported, not skipped", async () => {
    /*
     * Skipping it produces a publish that confirms and then serves a site with
     * a hole in it -- which fails at isolate startup, naming neither package
     * nor version. This is the failure `publishArtifacts` exists to prevent, so
     * if it happens anyway it has to be said out loud.
     */
    const { result } = await run(
      client({
        declare: async () => ({
          publishId: "pub_1",
          state: "awaiting-artifacts",
          project: { publicProjectId: "p", siteUrl: null },
          uploads: [slot("chunk/client/mystery.js")],
          have: [],
        }),
      }),
      [artifact("server")],
    );
    expect(result.status).toBe("failed");
    expect("message" in result && result.message).toContain(
      "chunk/client/mystery.js",
    );
  });
});

describe("when something goes wrong", () => {
  test("a build that does not render is not promoted", async () => {
    let promoted = false;
    const { result } = await run(
      client({
        verify: async () => ({
          publishId: "pub_1",
          state: "failed",
          ok: false,
          problems: [{ code: "RENDER_FAILED", message: "boom" }],
          previewUrl: null,
        }),
        promote: async () => {
          promoted = true;
          throw new Error("must not be reached");
        },
      }),
    );
    expect(result.status).toBe("failed");
    expect(promoted).toBe(false);
    expect("problems" in result && result.problems[0]?.code).toBe(
      "RENDER_FAILED",
    );
  });

  test("a thrown error becomes a value, so a handler can render it", async () => {
    // Behind a React handler a rejection at an await boundary is an unhandled
    // rejection and a spinner that never stops.
    const { result } = await run(
      client({
        declare: async () => {
          throw new Error("content is unreachable");
        },
      }),
    );
    expect(result).toEqual({
      status: "failed",
      publishId: null,
      message: "content is unreachable",
      problems: [],
    });
  });
});
