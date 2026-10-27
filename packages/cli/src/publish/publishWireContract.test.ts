import {
  parseArtifacts,
  parseDeclare,
  parseProblems,
  parsePromote,
  parsePublishToken,
  parseStatus,
  parseVerify,
} from "@valbuild/shared/internal";

/**
 * What content actually answers, run through the parsers that read it.
 *
 * These fixtures are COPIED FROM `home` - `content/src/handlers/Api.ts` for the
 * shapes, and the handlers beside it for the values they really send - not
 * written from what this side wishes it received. That is the whole point: the
 * fake in `runPublish.test.ts` speaks whatever dialect this CLI expects, so a
 * suite that is green against the fake says nothing about the service the fake
 * stands in for. `home` and `@valbuild/server` have already diverged three
 * times this way; `homeWireContract.test.ts` in `@valbuild/server` is the same
 * test for the routes the Studio uses.
 *
 * When `home`'s publish handlers change, change these fixtures with them, and
 * `contentApi.ts` with both. A failure here is the two repositories drifting,
 * and it is the only thing on this side that can say so.
 *
 * Source: branch `claude/new-project-studio-saves-0g9ksb`, commit `ecf3b8d`.
 */

/** `Api["/publish"]["POST"]["res"]`, as `postPublish.ts` builds it. */
const HOME_DECLARE = {
  publishId: "3f1b5f4e-2f1a-4c1e-9f77-0d3a4b5c6d7e",
  state: "awaiting-artifacts",
  project: {
    publicProjectId: "a1b2c3d",
    siteUrl: "https://site.example",
  },
  uploads: [
    {
      key: "server",
      url: "https://fsn1.your-objectstorage.com/val-publish/0f0e.../publish/aa11?X-Amz-Signature=deadbeef",
      // `mintUploadSlots`: the size is signed into the URL, not declared here.
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      expiresAt: "2026-09-19T10:00:00.000Z",
    },
  ],
  have: ["client", "public/index.html"],
};

/**
 * The same route when the build is already published.
 *
 * `postPublish.ts` returns early with no slots at all: re-opening would mint
 * permission to overwrite the bytes of a build that is currently serving.
 */
const HOME_DECLARE_LIVE = {
  publishId: "3f1b5f4e-2f1a-4c1e-9f77-0d3a4b5c6d7e",
  state: "live",
  project: { publicProjectId: "a1b2c3d", siteUrl: "https://site.example" },
  uploads: [],
  have: ["server", "client"],
};

/** A project with no site yet is reported, not refused. */
const HOME_DECLARE_NO_SITE = {
  ...HOME_DECLARE,
  project: { publicProjectId: "a1b2c3d", siteUrl: null },
};

/** `Api["/publish/:publishId/artifacts"]["POST"]["res"]`. */
const HOME_ARTIFACTS = { state: "ready", problems: [] };

/**
 * The 409, with `confirmArtifacts`'s own problems in `details`.
 *
 * Both of these say "declare again" in the hint, which is what the round in
 * `runPublish.ts` does.
 */
const HOME_ARTIFACTS_CONFLICT = {
  statusCode: 409,
  message: "Some artifacts did not arrive as declared",
  details: [
    {
      code: "ARTIFACT_NOT_UPLOADED",
      message:
        "These artifacts were declared but nothing was uploaded for them.",
      hint: "Upload slots expire. Declare the publish again for fresh ones.",
      keys: ["public/app.css"],
    },
    {
      code: "ARTIFACT_MISMATCH",
      message: "What was uploaded is not what was declared.",
      hint: "The bytes at that key do not match the sha256 or the size given for it.",
      keys: ["server"],
    },
  ],
};

/** `Api["/publish/:publishId/verify"]["POST"]["res"]`, both ways. */
const HOME_VERIFY_OK = {
  state: "verified",
  ok: true,
  // `CANARY_HAS_NO_PREVIEW = null`. The field is in the contract; there is
  // nowhere to point at yet.
  previewUrl: null,
  problems: [],
};

const HOME_VERIFY_FAILED = {
  state: "failed",
  ok: false,
  previewUrl: null,
  problems: [
    {
      code: "PLATFORM_BUILD_FAILED",
      message: "rolldown: Could not resolve './missing'",
      hint: "The canary build failed. Nothing was promoted.",
    },
  ],
};

/** `Api["/publish/:publishId/promote"]["POST"]["res"]`. */
const HOME_PROMOTE = {
  state: "live",
  url: "https://site.example",
  commit: "1234567890abcdef1234567890abcdef12345678",
};

/**
 * The stale pointer, as `postPublishPromote.ts` really answers it.
 *
 * The API's written contract has a top-level `head` with the sha the branch is
 * at now; the handler does not send one, and puts the code in `details` like
 * every other refusal. The CLI reads it this way and takes `head` if it ever
 * turns up.
 */
const HOME_PROMOTE_STALE = {
  statusCode: 409,
  message:
    "This build's commit is no longer the head of its branch, so it was not " +
    "promoted. Rebuild from the current head.",
  details: [{ code: "POINTER_STALE", message: "not-fast-forward" }],
};

/** `Api["/publish/:publishId"]["GET"]["res"]`. */
const HOME_STATUS = {
  publishId: "3f1b5f4e-2f1a-4c1e-9f77-0d3a4b5c6d7e",
  state: "awaiting-artifacts",
  buildHash: "b3a1c2d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  missing: ["public/app.css"],
  problems: [],
};

/** A declaration refused before any slot is minted, from `publishPlan.ts`. */
const HOME_DECLARE_REFUSED = {
  statusCode: 400,
  message: "This publish cannot be declared",
  details: [
    {
      code: "ARTIFACT_MISSING",
      message: "A publish needs at least a server and a client bundle.",
      keys: ["server"],
    },
    {
      code: "LAYER_REV_MISSING",
      message: "A layer artifact must be declared with the layerRev it is.",
      keys: ["layer"],
    },
  ],
};

/** `Api["/publish-token"]["POST"]["res"]`, from `postPublishToken.ts`. */
const HOME_PUBLISH_TOKEN = {
  token:
    "val_pt_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd",
  expiresAt: "2026-09-19T09:10:00.000Z",
  publicProjectId: "a1b2c3d",
  productionUrl: "https://site.example",
};

describe("the publish API, as content answers it", () => {
  test("a declaration comes back with its slots and what was already held", () => {
    const declared = parseDeclare(HOME_DECLARE);

    expect(declared.publishId).toBe("3f1b5f4e-2f1a-4c1e-9f77-0d3a4b5c6d7e");
    expect(declared.state).toBe("awaiting-artifacts");
    expect(declared.project.siteUrl).toBe("https://site.example");
    expect(declared.have).toEqual(["client", "public/index.html"]);
    expect(declared.uploads).toHaveLength(1);
    expect(declared.uploads[0].method).toBe("PUT");
    expect(declared.uploads[0].headers["content-type"]).toBe(
      "application/octet-stream",
    );
  });

  test("a build that is already live comes back with no slots", () => {
    const declared = parseDeclare(HOME_DECLARE_LIVE);

    expect(declared.state).toBe("live");
    expect(declared.uploads).toEqual([]);
  });

  test("a project with no site yet parses, rather than being a failure", () => {
    expect(parseDeclare(HOME_DECLARE_NO_SITE).project.siteUrl).toBeNull();
  });

  test("confirming answers with a state", () => {
    expect(parseArtifacts(HOME_ARTIFACTS).state).toBe("ready");
  });

  test("the artifacts that did not arrive come back with the hint that says what to do", () => {
    const problems = parseProblems(HOME_ARTIFACTS_CONFLICT.details);

    expect(problems.map((problem) => problem.code)).toEqual([
      "ARTIFACT_NOT_UPLOADED",
      "ARTIFACT_MISMATCH",
    ]);
    expect(problems[0].hint).toContain("Declare the publish again");
    expect(problems[0].keys).toEqual(["public/app.css"]);
  });

  test("a verify says whether it rendered, and why not", () => {
    expect(parseVerify(HOME_VERIFY_OK)).toEqual({
      state: "verified",
      ok: true,
      previewUrl: null,
      problems: [],
    });

    const failed = parseVerify(HOME_VERIFY_FAILED);
    expect(failed.ok).toBe(false);
    // The platform's own code, passed through by content unreworded.
    expect(failed.problems[0].code).toBe("PLATFORM_BUILD_FAILED");
    expect(failed.problems[0].hint).toBe(
      "The canary build failed. Nothing was promoted.",
    );
  });

  test("a promote says where it went live and at which commit", () => {
    expect(parsePromote(HOME_PROMOTE)).toEqual({
      state: "live",
      url: "https://site.example",
      commit: "1234567890abcdef1234567890abcdef12345678",
    });
  });

  test("a stale pointer carries its code in details, where the handler puts it", () => {
    const problems = parseProblems(HOME_PROMOTE_STALE.details);

    expect(problems).toHaveLength(1);
    expect(problems[0].code).toBe("POINTER_STALE");
    // And the sentence a publisher acts on is content's own `message`, which
    // the envelope carries beside the details rather than inside them.
    expect(HOME_PROMOTE_STALE.message).toContain(
      "Rebuild from the current head",
    );
  });

  test("a status answers what is still missing", () => {
    const status = parseStatus(HOME_STATUS);

    expect(status.state).toBe("awaiting-artifacts");
    expect(status.missing).toEqual(["public/app.css"]);
  });

  test("a refused declaration carries every problem, not the first", () => {
    const problems = parseProblems(HOME_DECLARE_REFUSED.details);

    expect(problems.map((problem) => problem.code)).toEqual([
      "ARTIFACT_MISSING",
      "LAYER_REV_MISSING",
    ]);
  });

  test("the exchange answers with a project token and when it dies", () => {
    const exchanged = parsePublishToken(
      HOME_PUBLISH_TOKEN,
      "POST /v1/acme/site/publish-token",
    );

    expect(exchanged.token.startsWith("val_pt_")).toBe(true);
    expect(exchanged.expiresAt).toBe("2026-09-19T09:10:00.000Z");
  });

  test("a standing token has no expiry, and that is not a missing field", () => {
    expect(
      parsePublishToken({ ...HOME_PUBLISH_TOKEN, expiresAt: null }, "exchange")
        .expiresAt,
    ).toBeNull();
  });
});
