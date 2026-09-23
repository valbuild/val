import { ValOpsHttp } from "./ValOpsHttp";
import { result } from "@valbuild/core/fp";
import type { AuthorId } from "./ValOps";
import type { ModuleFilePath, PatchId, SerializedSchema } from "@valbuild/core";

/**
 * What `home` actually answers, run through the parsers that read it.
 *
 * These fixtures are COPIED FROM `home`'s `content/src/handlers/Api.ts`, not
 * written from what this side wishes it received. That is the whole point: the
 * e2e mock speaks val's dialect, so a suite that is green against the mock says
 * nothing about the service the mock stands in for — and this is the third time
 * the two have diverged on this feature, the first where it was not a missing
 * check but a different wire format.
 *
 * The divergence it was written for: `home` answered `{ groups: [{ id, … }] }`
 * and `{ patchGroupId, added }`, while `ValOpsHttp` parses `{ patchGroups: [{
 * patchGroupId, … }] }` and `{ patchGroupId, patchIds }`. Zod rejected every
 * one, so in production every stage and unstage was a 500, the chain annotation
 * never arrived, and a scoped draft render treated the lookup as failed and
 * rendered base — dropping every pending patch from every `fetchVal`.
 *
 * When `home`'s `Api.ts` changes, change these fixtures with it. A failure here
 * is the two repos drifting, and it is the only place that can say so.
 */

const PROJECT = "acme/site";
const CONTENT_URL = "https://content.val.build";

/** `home` — `Api["/patch-groups"]["GET"]["res"]`. */
const HOME_PATCH_GROUPS = {
  patchGroups: [
    {
      patchGroupId: "11111111-1111-4111-8111-111111111111",
      authorId: "22222222-2222-4222-8222-222222222222",
      createdAt: "2026-01-01T00:00:00.000Z",
      publishedAt: null,
      patchIds: ["33333333-3333-4333-8333-333333333333"],
    },
  ],
};

/** `home` — `Api["/patch-groups/:patchGroupId/patches"]["POST"]["res"]`. */
const HOME_STAGE = {
  patchGroupId: "11111111-1111-4111-8111-111111111111",
  patchIds: ["33333333-3333-4333-8333-333333333333"],
};

/** `home` — the same endpoint's `DELETE`. */
const HOME_UNSTAGE = {
  patchGroupId: "11111111-1111-4111-8111-111111111111",
  patchIds: [] as string[],
};

/** Every request the ops made, so a test can assert on what went out. */
type SentRequest = {
  url: string;
  headers: Record<string, string>;
  body?: unknown;
};

function opsAnswering(
  body: unknown,
  status = 200,
  options?: {
    /**
     * The repository this deployment was built from, or `null` for one that was
     * not built from any. See `git` on `ValApiOptions`.
     */
    git?: { commit: string; branch: string } | null;
  },
) {
  const originalFetch = global.fetch;
  const sent: SentRequest[] = [];
  global.fetch = (async (
    url: string,
    init?: { headers?: HeadersInit; body?: string },
  ) => {
    sent.push({
      url: String(url),
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      ),
      body: init?.body === undefined ? undefined : JSON.parse(init.body),
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 500 ? "Internal Server Error" : "",
      // `saveSourceFilePatch` reads this before it decides whether the body is
      // worth unwrapping, so a stub without it takes the "not JSON" branch and
      // the test would pass on a message this file is about.
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? "application/json" : null,
      },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }) as unknown as typeof fetch;
  const ops = new ValOpsHttp(
    CONTENT_URL,
    PROJECT,
    options?.git === undefined
      ? { commit: "commit-sha", branch: "main" }
      : options.git,
    { apiKey: "key" },
    // The module side is irrelevant here: nothing on this path evaluates a
    // module or reads a schema.
    { modules: [] } as never,
  );
  return {
    ops,
    sent,
    restore: () => {
      global.fetch = originalFetch;
    },
  };
}

test("home's patch-group listing parses", async () => {
  const { ops, restore } = opsAnswering(HOME_PATCH_GROUPS);
  try {
    const res = await ops.getPatchGroups({ fresh: true });

    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error(res.status);
    expect(res.patchGroups).toHaveLength(1);
    // The two fields the shapes disagreed on. A rename on either side lands
    // here rather than as a 500 in production.
    expect(res.patchGroups[0].patchGroupId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(res.patchGroups[0].patchIds).toEqual([
      "33333333-3333-4333-8333-333333333333",
    ]);
  } finally {
    restore();
  }
});

test("home's stage response parses, and carries the group's membership", async () => {
  const { ops, restore } = opsAnswering(HOME_STAGE);
  try {
    const res = await ops.stagePatches(
      "11111111-1111-4111-8111-111111111111",
      ["33333333-3333-4333-8333-333333333333" as PatchId],
      [],
      "22222222-2222-4222-8222-222222222222" as AuthorId,
    );

    expect(res.error).toBe(undefined);
    // The full membership, not the rows the request changed: staging is an
    // idempotent upsert, so a retry changes none and `added: []` would read as
    // "your group is empty" on a request that succeeded.
    expect(res.patchIds).toEqual(["33333333-3333-4333-8333-333333333333"]);
  } finally {
    restore();
  }
});

test("home's unstage response parses, and an emptied group is not an error", async () => {
  const { ops, restore } = opsAnswering(HOME_UNSTAGE);
  try {
    const res = await ops.unstagePatches(
      "11111111-1111-4111-8111-111111111111",
      ["33333333-3333-4333-8333-333333333333" as PatchId],
      [],
      "22222222-2222-4222-8222-222222222222" as AuthorId,
    );

    expect(res.error).toBe(undefined);
    expect(res.patchIds).toEqual([]);
  } finally {
    restore();
  }
});

test("a body in the OLD shape is refused rather than silently read as empty", async () => {
  /*
   * The failure this file exists for, pinned from the other side.
   *
   * Before `home` was renamed it answered `{ groups: [{ id, … }] }`. Nothing
   * threw: zod rejected it, `getPatchGroups` returned `error`, and every caller
   * degraded quietly — `refuseUnlessOwn` to a 500, a scoped draft render to
   * base with no pending content at all. Asserting the refusal is what makes a
   * regression here loud instead of invisible.
   */
  const { ops, restore } = opsAnswering({
    groups: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        authorId: "22222222-2222-4222-8222-222222222222",
        createdAt: "2026-01-01T00:00:00.000Z",
        publishedAt: null,
        patchIds: [],
      },
    ],
  });
  try {
    const res = await ops.getPatchGroups({ fresh: true });
    expect(res.status).toBe("error");
  } finally {
    restore();
  }
});

/**
 * WHO is asking, on every request whose answer depends on it.
 *
 * `home` reads the caller's identity from `x-val-profile-id`: the app's API key
 * names the PROJECT, and every patch group belongs to a PERSON. The three
 * routes whose answer turns on that — stage, unstage and now commit — must all
 * send it, and `home` refuses each of them 403 "Cannot resolve the caller's
 * profile" without it.
 *
 * Commit was the one that did not. `home#55` added an ownership check to
 * `postCommit` so a publish cannot close somebody else's group, and against
 * that check a client sending only the API key cannot publish AT ALL once it
 * names a group — which is the normal full publish, since `publish` names the
 * group whenever the commit empties it. Nothing caught it: the e2e mock trusted
 * whatever group it was named, so the suite was green against a service that
 * refuses.
 */
const PROFILE = "22222222-2222-4222-8222-222222222222" as AuthorId;

function profileHeaderOf(sent: { headers: Record<string, string> }[]) {
  return sent.map((request) => request.headers["x-val-profile-id"]);
}

test("stage and unstage say who is asking", async () => {
  const stage = opsAnswering(HOME_STAGE);
  try {
    await stage.ops.stagePatches(
      "11111111-1111-4111-8111-111111111111",
      ["33333333-3333-4333-8333-333333333333" as PatchId],
      [],
      PROFILE,
    );
    expect(profileHeaderOf(stage.sent)).toEqual([PROFILE]);
  } finally {
    stage.restore();
  }

  const unstage = opsAnswering(HOME_UNSTAGE);
  try {
    await unstage.ops.unstagePatches(
      "11111111-1111-4111-8111-111111111111",
      ["33333333-3333-4333-8333-333333333333" as PatchId],
      [],
      PROFILE,
    );
    expect(profileHeaderOf(unstage.sent)).toEqual([PROFILE]);
  } finally {
    unstage.restore();
  }
});

/**
 * `home` — `Api["/commits/:commitSha/modules"]["GET"]["res"]`, copied from there.
 *
 * The reading half of the same contract the commit test pins the writing half
 * of. Drift here is quieter than a 500: `ValOpsHttp` validates with zod, so a
 * renamed field makes every commit read as unreadable — which looks exactly
 * like a project with no history.
 */
const HOME_COMMIT_MODULES = {
  commitSha: "a3f19c2",
  parentCommitSha: "p1",
  complete: true,
  modules: [
    {
      moduleFilePath: "/content/landing.val.ts",
      commitSha: "a3f19c2",
      sourceSha: "aaaa",
      schemaSha: "bbbb",
      source: { heading: "Content as code" },
      schema: { type: "object", items: {}, opt: false },
      unavailable: false,
    },
  ],
};

test("a commit's stored modules parse, with the schema left unvalidated", async () => {
  const { ops, restore } = opsAnswering(HOME_COMMIT_MODULES);
  try {
    const res = await ops.getCommitModules("a3f19c2");
    if (result.isErr(res)) {
      throw new Error(`did not parse: ${JSON.stringify(res.error)}`);
    }
    expect(res.value.modules).toHaveLength(1);
    expect(res.value.modules[0].moduleFilePath).toBe("/content/landing.val.ts");
    expect(res.value.modules[0].source).toEqual({
      heading: "Content as code",
    });
    // The schema arrives unchecked ON PURPOSE. Validating it at the transport
    // boundary would turn "written by a different version of Val" into a failed
    // REQUEST instead of one module that cannot be shown.
    expect(res.value.modules[0].schema).toBeDefined();
  } finally {
    restore();
  }
});

test("an as-of read that history cannot cover whole says so", async () => {
  // The trap this closes: `as_of` reads the project as a commit left it, but
  // the index only has rows for commits made after history started being
  // recorded. A module last edited before that is simply absent — and a
  // whole-project revert would leave it untouched without telling anyone.
  const { ops, restore } = opsAnswering({
    ...HOME_COMMIT_MODULES,
    complete: false,
  });
  try {
    const res = await ops.getCommitModules("a3f19c2", { asOf: true });
    if (result.isErr(res)) throw new Error("did not parse");
    expect(res.value.complete).toBe(false);
  } finally {
    restore();
  }
});

test("an older content server, which never had the flag, still parses", async () => {
  const withoutFlag: Record<string, unknown> = { ...HOME_COMMIT_MODULES };
  delete withoutFlag["complete"];
  const { ops, restore } = opsAnswering(withoutFlag);
  try {
    const res = await ops.getCommitModules("a3f19c2");
    if (result.isErr(res)) throw new Error("did not parse");
    // It only ever answered "what this commit changed", and that is whole.
    expect(res.value.complete).toBe(true);
  } finally {
    restore();
  }
});

test("a module we hold a hash for but no object is unavailable, not empty", async () => {
  const { ops, restore } = opsAnswering({
    ...HOME_COMMIT_MODULES,
    modules: [
      { ...HOME_COMMIT_MODULES.modules[0], source: null, unavailable: true },
    ],
  });
  try {
    const res = await ops.getCommitModules("a3f19c2");
    if (result.isErr(res)) throw new Error("did not parse");
    expect(res.value.modules[0].unavailable).toBe(true);
  } finally {
    restore();
  }
});

/**
 * `home` — the shape `postCommit.ts`'s `BodyDTO` parses out of `modules`.
 *
 * Copied from there, not invented here. `home` stores what it finds under this
 * key and nothing else: a commit whose `modules` never arrives is a commit
 * with no history to restore from, and it fails SILENTLY - the publish
 * succeeds, the archive is written, and the omission only shows up months
 * later as a commit the Studio cannot open.
 */
test("a commit carries each changed module's data and schema, under the key home reads", async () => {
  const { ops, sent, restore } = opsAnswering({
    updatedFiles: [],
    commit: "abc1234",
    branch: "main",
  });
  const bodies: unknown[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: string, init?: { body?: string }) => {
    if (typeof url === "string" && url.endsWith("/commit") && init?.body) {
      bodies.push(JSON.parse(init.body));
    }
    return originalFetch(url as string, init as RequestInit);
  }) as typeof global.fetch;
  try {
    await ops.commit(
      {
        patchedSourceFiles: {},
        patchedJsonEntries: {},
        previousSourceFiles: {},
        partiallyPatchedSourceFiles: {},
        patchedBinaryFilesDescriptors: {},
        appliedPatches: {},
        hasErrors: false,
        sourceFilePatchErrors: {},
        binaryFilePatchErrors: {},
        unappliablePatches: {},
        skippedPatches: {},
        triedPatches: {},
        moduleVersions: {
          ["/content/landing.val.ts" as ModuleFilePath]: {
            source: { title: "Hello" },
            schema: {
              type: "object",
              items: { title: { type: "string", opt: false } },
              opt: false,
            } as unknown as SerializedSchema,
          },
        },
      },
      "ship it",
      PROFILE,
      "/public/val",
    );
    const body = bodies[0] as {
      modules?: Record<string, { source: unknown; schema: unknown }>;
    };
    expect(body.modules).toBeDefined();
    const module = body.modules?.["/content/landing.val.ts"];
    // The DATA, not the `.val.ts` text: text is code, and parsing code back
    // into data is the thing this stopped depending on.
    expect(module?.source).toEqual({ title: "Hello" });
    expect(module?.schema).toMatchObject({ type: "object" });
  } finally {
    global.fetch = originalFetch;
    restore();
    void sent;
  }
});

test("a commit says who is publishing, so home can check the group is theirs", async () => {
  const { ops, sent, restore } = opsAnswering({
    updatedFiles: [],
    commit: "abc1234",
    branch: "main",
  });
  try {
    await ops.commit(
      {
        patchedSourceFiles: {},
        patchedJsonEntries: {},
        previousSourceFiles: {},
        partiallyPatchedSourceFiles: {},
        patchedBinaryFilesDescriptors: {},
        appliedPatches: {},
        hasErrors: false,
        sourceFilePatchErrors: {},
        binaryFilePatchErrors: {},
        unappliablePatches: {},
        skippedPatches: {},
        triedPatches: {},
        moduleVersions: {},
      },
      "ship it",
      PROFILE,
      "/public/val",
      undefined,
      "11111111-1111-4111-8111-111111111111",
    );

    const commitRequest = sent.find((request) =>
      request.url.endsWith("/commit"),
    );
    expect(commitRequest).toBeDefined();
    expect(commitRequest?.headers["x-val-profile-id"]).toBe(PROFILE);
  } finally {
    restore();
  }
});

test("a fresh read really does bypass the cache, and a default read really does use it", async () => {
  /*
   * The mechanism two ownership decisions rest on.
   *
   * `getPatchGroups` caches for a second so the several `fetchVal` calls in one
   * draft render do not each ask the content API. But two callers make a
   * DECISION from the answer rather than rendering it — `refuseUnlessOwn`, and
   * the chain annotation that `emptiesOwnPatchGroup` reads before a publish may
   * name a group — and a second-old list is enough to get those wrong: the same
   * author writing in a second tab joins the open group, so a cached membership
   * is one patch short and this tab closes a group that still holds work.
   *
   * Pinned here because `fresh` silently becoming a no-op is invisible
   * everywhere else — every caller keeps working, just on stale data.
   */
  const { ops, sent, restore } = opsAnswering(HOME_PATCH_GROUPS);
  try {
    await ops.getPatchGroups({ fresh: true });
    expect(sent).toHaveLength(1);

    // Inside the one-second window: the render path is content to reuse it.
    await ops.getPatchGroups();
    expect(sent).toHaveLength(1);

    // A decision, so it asks again.
    await ops.getPatchGroups({ fresh: true });
    expect(sent).toHaveLength(2);
  } finally {
    restore();
  }
});

/**
 * `home` — `HttpError` as `sendResult`'s catch writes it, copied from
 * `content/src/utils/sendResult.ts`.
 *
 * This is the answer to a handler that THREW, and it is shaped unlike every
 * other refusal in the service: the `message` is the constant string
 * "Internal Server Error", and the exception's own message — the only thing
 * that says what went wrong — is in `details`.
 *
 * `getErrorMessageFromUnknownJson` read `message` and dropped the rest, so a
 * patch save against a throwing content service put exactly
 * `{"type":"patch-error","message":"Internal Server Error"}` in front of an
 * editor, and the reason was never anywhere a person could reach: not in the
 * app's logs, which record the same relayed message, and not in the browser,
 * which only ever saw it.
 *
 * The `details` below is the real one from the incident that prompted this, and
 * it is worth reading as an example of what is being thrown away: it names the
 * column, the value and the query.
 */
const HOME_INTERNAL_ERROR = {
  statusCode: 500,
  message: "Internal Server Error",
  details:
    "Could not validate expected return columns. Validation error: Expected " +
    'string, received null at "patch_commit_sha". Query: "SELECT author, ' +
    'branch, patch_commit_sha, base_sha, seq_num, patch, patch_id ..."',
};

test("home's 500 reaches the editor with the reason it was carrying", async () => {
  const { ops, restore } = opsAnswering(HOME_INTERNAL_ERROR, 500);
  try {
    const res = await ops.createPatch(
      "/content/landing.val.ts" as ModuleFilePath,
      [{ op: "replace", path: ["title"], value: "Hello" }],
      "44444444-4444-4444-8444-444444444444" as PatchId,
      { type: "head", headBaseSha: "base" as never },
      null,
      PROFILE,
    );

    if (!result.isErr(res)) {
      throw new Error("a 500 must not be reported as a saved patch");
    }
    if (res.error.errorType !== "other") {
      throw new Error(`expected 'other', got '${res.error.errorType}'`);
    }
    // The constant is still there — it is what the service said — but it is no
    // longer the whole message, which is the difference between an error a
    // person can act on and one they can only report.
    expect(res.error.error.message).toContain("Internal Server Error");
    expect(res.error.error.message).toContain("patch_commit_sha");
    expect(res.error.error.message).not.toBe("Internal Server Error");
  } finally {
    restore();
  }
});

/**
 * A deployment built from no repository, writing a patch.
 *
 * This is what `git: null` MEANS on the wire, and it is the half of the
 * contract the incident above turned on: with no repository there is no commit
 * to record, so `POST /patches` carries neither `commit` nor `branch` and
 * `home` stores `val_patches.patch_commit_sha` as NULL and resolves the branch
 * from the project row.
 *
 * Pinned from this side because the two repos have to agree about it and only
 * one of them can be tested here. `home` made that column nullable for exactly
 * this case; a read path there that still requires a value turns the SECOND
 * edit in a row into a 500, because the first one is now somebody's parent.
 *
 * Omitted rather than sent as null, and the distinction is not cosmetic: a
 * content API that predates optional git validates the fields it is given, so
 * `branch: null` is a 400 on every write where an absent key is the older,
 * working shape.
 */
test("a deployment with no repository sends no commit and no branch", async () => {
  const { ops, sent, restore } = opsAnswering(
    { patchId: "44444444-4444-4444-8444-444444444444" },
    200,
    { git: null },
  );
  try {
    const res = await ops.createPatch(
      "/content/landing.val.ts" as ModuleFilePath,
      [{ op: "replace", path: ["title"], value: "Hello" }],
      "44444444-4444-4444-8444-444444444444" as PatchId,
      { type: "head", headBaseSha: "base" as never },
      null,
      PROFILE,
    );

    if (result.isErr(res)) {
      throw new Error(`did not save: ${JSON.stringify(res.error)}`);
    }
    const save = sent.find((request) => request.url.endsWith("/patches"));
    expect(save).toBeDefined();
    const body = save?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("commit");
    expect(body).not.toHaveProperty("branch");
    // Everything else still goes, including the position within the chain,
    // which is what orders patches when there is no commit to order them by.
    expect(body).toHaveProperty("baseSha");
    expect(body.authorId).toBe(PROFILE);
  } finally {
    restore();
  }
});

test("a deployment built from a repository still sends both", async () => {
  const { ops, sent, restore } = opsAnswering({
    patchId: "44444444-4444-4444-8444-444444444444",
  });
  try {
    await ops.createPatch(
      "/content/landing.val.ts" as ModuleFilePath,
      [{ op: "replace", path: ["title"], value: "Hello" }],
      "44444444-4444-4444-8444-444444444444" as PatchId,
      { type: "head", headBaseSha: "base" as never },
      null,
      PROFILE,
    );

    const save = sent.find((request) => request.url.endsWith("/patches"));
    const body = save?.body as Record<string, unknown>;
    expect(body.commit).toBe("commit-sha");
    expect(body.branch).toBe("main");
  } finally {
    restore();
  }
});

/**
 * A DRAFT FILE'S BYTES, and the encoding the two sides have to agree on.
 *
 * `PUT /files` answers a `value` per file, and for a while that field carried
 * TWO encodings told apart only by which branch produced them: a `data:` URL
 * for a `patch` file, plain base64 for a `repo` one. `home#38` made both plain
 * base64 and val#563 stopped unwrapping the data URL — a PAIRED change, which
 * is the dangerous kind, because either half shipped alone is silently wrong.
 *
 * It did ship alone, and here is what that looked like: an editor uploaded an
 * image, the Studio showed a broken tile, and the image appeared correctly the
 * moment the change was PUBLISHED. `bufferFromDataUrl` found no `;base64,` in
 * what it was handed, returned undefined,
 * `getBase64EncodedBinaryFileFromPatch` turned that into `null`, and
 * `/api/val/files?patch_id=…` answered 404. Nothing logged anything. The
 * published image was fine because that read goes through the `repo` branch,
 * which was already plain base64 — so the failure looked like "draft images do
 * not work" rather than like an encoding mismatch.
 *
 * Pinned HERE rather than only in e2e because the e2e mock is ours: it answers
 * base64 today, and if it ever went back to a data URL the suite would stay
 * green against a service that does not. That is the whole reason this file
 * exists. The two e2e tests that would notice a regression are incidental —
 * `http/aiChat.spec.ts` (an AI-written image) and `http/remoteFiles.spec.ts`
 * (a remote one) — and neither is the plain local upload that broke.
 */

/** Bytes with a byte over 0x7f, which is what a wrong encoding mangles first. */
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xfe, 0x42,
]);
const FILE_PATH = "/public/val/photo.png";
const PATCH_ID = "55555555-5555-4555-8555-555555555555" as PatchId;

/** `home` — `putFiles.ts` builds a patch file's `value` as `bytes.toString("base64")`. */
const HOME_PATCH_FILE = {
  files: [
    {
      filePath: FILE_PATH,
      location: "patch",
      patchId: PATCH_ID,
      value: PNG_BYTES.toString("base64"),
      remote: false,
    },
  ],
};

/** The same endpoint's `repo` branch, which has always been plain base64. */
const HOME_REPO_FILE = {
  files: [
    {
      filePath: FILE_PATH,
      location: "repo",
      commitSha: "commit-sha",
      value: PNG_BYTES.toString("base64"),
    },
  ],
};

test("a draft file's bytes come back as home sends them: plain base64", async () => {
  const { ops, restore } = opsAnswering(HOME_PATCH_FILE);
  try {
    const bytes = await ops.getBase64EncodedBinaryFileFromPatch(
      FILE_PATH,
      PATCH_ID,
      false,
    );

    // Byte for byte. A length check would not do: a mis-decode of this value
    // still produces *some* bytes, and "an image came back" is exactly what
    // the broken tile looked like.
    expect(bytes).not.toBeNull();
    expect(Buffer.from(bytes!)).toEqual(PNG_BYTES);
  } finally {
    restore();
  }
});

test("and a published file's bytes do too, through the other branch", async () => {
  // The two branches reading one field differently is the whole bug, so the
  // pair is asserted together rather than separately.
  const { ops, restore } = opsAnswering(HOME_REPO_FILE);
  try {
    const bytes = await ops.getBinaryFile(FILE_PATH);

    expect(bytes).not.toBeNull();
    expect(Buffer.from(bytes!)).toEqual(PNG_BYTES);
  } finally {
    restore();
  }
});

test("a data: URL in that field is NOT the same bytes, which is why it broke", async () => {
  /*
   * The old shape, run through today's reader. This does not throw and it does
   * not answer null — `Buffer.from(dataUrl, "base64")` decodes the prefix as
   * though it were payload and skips what it cannot — so a service that went
   * back to data URLs would serve a corrupt image rather than an error.
   *
   * Asserted as "not equal" rather than as some particular garbage: the point
   * is that the two encodings are not interchangeable, so whoever finds this
   * test knows why the tile is broken and which side to look at.
   */
  const { ops, restore } = opsAnswering({
    files: [
      {
        ...HOME_PATCH_FILE.files[0],
        value: `data:image/png;base64,${PNG_BYTES.toString("base64")}`,
      },
    ],
  });
  try {
    const bytes = await ops.getBase64EncodedBinaryFileFromPatch(
      FILE_PATH,
      PATCH_ID,
      false,
    );

    expect(bytes).not.toBeNull();
    expect(Buffer.from(bytes!)).not.toEqual(PNG_BYTES);
  } finally {
    restore();
  }
});
