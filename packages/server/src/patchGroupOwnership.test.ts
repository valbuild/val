import { refuseUnlessOwn } from "./ValServer";
import type { ValOpsHttp } from "./ValOpsHttp";
import type { PatchId } from "@valbuild/core";

/**
 * Who may change a patch group.
 *
 * This is the ENTIRE authorization for stage and unstage. `getAuth` only proves
 * a session exists, and every call this process makes to the content API
 * carries the app's API key rather than the editor's identity — so the content
 * API cannot decide either. If this function is wrong, nothing catches it.
 *
 * What it is guarding against is concrete rather than theoretical:
 * `GET /patches?include_patch_groups=true` hands every editor the id and author
 * of every open group on the branch. Without this check, any logged-in editor
 * could take another author's group id and unstage their patches — their next
 * publish silently ships less than they staged — or stage into it, so their
 * next publish ships the caller's work under their name.
 */

const GROUP = "group-alice";

function opsWith(
  answer: Awaited<ReturnType<ValOpsHttp["getPatchGroups"]>>,
): ValOpsHttp {
  // Only `getPatchGroups` is reached, so the rest of the class is irrelevant
  // here. A subclass would drag in a constructor that wants a project and
  // credentials to test one predicate.
  const ops: Pick<ValOpsHttp, "getPatchGroups"> = {
    getPatchGroups: async () => answer,
  };
  return ops as ValOpsHttp;
}

function groups(authorId: string | null, publishedAt: string | null = null) {
  return opsWith({
    status: "ok",
    patchGroups: [
      {
        patchGroupId: GROUP,
        authorId,
        createdAt: "2026-01-01T00:00:00.000Z",
        publishedAt,
        patchIds: ["p1" as PatchId],
      },
    ],
  });
}

test("the group's own author may change it", async () => {
  expect(await refuseUnlessOwn(groups("alice"), GROUP, "alice")).toBeNull();
});

test("another author may not", async () => {
  const refusal = await refuseUnlessOwn(groups("alice"), GROUP, "mallory");
  expect(refusal?.status).toBe(403);
  expect(refusal?.message).toContain("your own patch group");
});

test("a group with no author belongs to nobody, not to everybody", async () => {
  /*
   * A null author is a write made by an api key or a PAT. Comparing it to a
   * caller whose id is also unknown would be `null === null` — true — and the
   * caller would inherit a group they have no claim to. The same shape bit the
   * client-side `useCurrentPatchGroup` earlier on this branch.
   */
  const refusal = await refuseUnlessOwn(groups(null), GROUP, "alice");
  expect(refusal?.status).toBe(403);
});

test("a group id the branch does not have is refused, not passed through", async () => {
  // Same 403 and same words as "not yours": the route schema has no 404, and
  // `GET /patches` lists every group anyway, so there is nothing to hide by
  // telling the two apart.
  const refusal = await refuseUnlessOwn(groups("alice"), "made-up", "alice");
  expect(refusal?.status).toBe(403);
  expect(refusal?.message).toContain("your own patch group");
});

test("an already-published group is refused with 409, not 403", async () => {
  /*
   * Distinct from "not yours" because the answer to it is different: this group
   * IS the caller's, it has simply shipped and can never be written again. The
   * content API answers 409 for the same case; refusing here saves the round
   * trip.
   */
  const refusal = await refuseUnlessOwn(
    groups("alice", "2026-01-02T00:00:00.000Z"),
    GROUP,
    "alice",
  );
  expect(refusal?.status).toBe(409);
  expect(refusal?.message).toContain("already published");
});

test("a failed lookup refuses rather than allowing unverified", async () => {
  /*
   * Fail CLOSED. This is a mutation, and the alternative — letting it through
   * because we could not check — turns one flaky read into somebody else's
   * publish shipping the wrong set.
   */
  const refusal = await refuseUnlessOwn(
    opsWith({ status: "error", message: "content API is down" }),
    GROUP,
    "alice",
  );
  expect(refusal?.status).toBe(500);
  expect(refusal?.message).toContain("not changed");
});
