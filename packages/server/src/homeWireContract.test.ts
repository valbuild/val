import { ValOpsHttp } from "./ValOpsHttp";
import type { AuthorId } from "./ValOps";
import type { PatchId } from "@valbuild/core";

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
type SentRequest = { url: string; headers: Record<string, string> };

function opsAnswering(body: unknown, status = 200) {
  const originalFetch = global.fetch;
  const sent: SentRequest[] = [];
  global.fetch = (async (url: string, init?: { headers?: HeadersInit }) => {
    sent.push({
      url: String(url),
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      ),
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }) as unknown as typeof fetch;
  const ops = new ValOpsHttp(
    CONTENT_URL,
    PROJECT,
    "commit-sha",
    "main",
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
