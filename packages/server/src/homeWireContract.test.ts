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

function opsAnswering(body: unknown, status = 200) {
  const originalFetch = global.fetch;
  global.fetch = (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
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
