import { PatchId } from "@valbuild/core";
import { ValOpsHttp } from "./ValOpsHttp";

/**
 * Resolving "which pending patches is this person allowed to see".
 *
 * `fetchVal` in draft mode has no client state, so it cannot name its own patch
 * group ids — it asks `/sources/~` for `own_patch_groups_only` and the server
 * works them out from the session. This covers the reading half of that: what
 * `ValOpsHttp.getPatchGroups` hands back, and — the part that matters — what it
 * does when the content API will not answer.
 *
 * The failure mode being guarded is silent and severe. If a lookup failure fell
 * back to "no filter", a draft preview would quietly render every unpublished
 * patch on the branch, including other people's, and nothing on the page would
 * say so.
 */
const PROJECT = "acme/site";

function ops(): ValOpsHttp {
  return new ValOpsHttp(
    "https://content.val.build",
    PROJECT,
    "commit-sha",
    "main",
    { apiKey: "key" },
    // The module side is irrelevant here: nothing on this path evaluates a
    // module or reads a schema.
    { modules: [] } as never,
  );
}

/**
 * Stub `fetch` for the duration of one call.
 *
 * Installed around the AWAIT rather than around the constructor. The first
 * version of this helper restored `fetch` in a `finally` before returning the
 * ops object, so by the time `getPatchGroups` ran the real `fetch` was back and
 * the test was making live requests to content.val.build — which answered 403
 * and made the assertion fail for a reason that had nothing to do with the code.
 * A test that reaches the network is not a unit test, and it fails or passes on
 * somebody else's uptime.
 */
async function withFetch<T>(
  fetchImpl: typeof fetch,
  run: () => Promise<T>,
): Promise<T> {
  const original = global.fetch;
  global.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    global.fetch = original;
  }
}

const GROUPS = {
  patchGroups: [
    {
      patchGroupId: "group-alice",
      authorId: "alice",
      createdAt: "2026-01-01T00:00:00Z",
      publishedAt: null,
      patchIds: ["p1", "p2"] as PatchId[],
    },
    {
      patchGroupId: "group-bob",
      authorId: "bob",
      createdAt: "2026-01-01T00:00:00Z",
      publishedAt: null,
      patchIds: ["p3"] as PatchId[],
    },
  ],
};

test("reads the groups on the branch, with what each holds", async () => {
  const calls: string[] = [];
  const res = await withFetch(
    (async (url: string) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => GROUPS };
    }) as unknown as typeof fetch,
    () => ops().getPatchGroups(),
  );

  expect(res).toEqual({ status: "ok", patchGroups: GROUPS.patchGroups });
  expect(calls).toEqual([
    `https://content.val.build/v1/${PROJECT}/patch-groups`,
  ]);
});

test("an unreachable content API is an error, not an empty success", async () => {
  // The distinction the caller depends on. "No groups" and "could not ask" must
  // not look the same: one means this person has staged nothing, the other
  // means we do not know — and only the second should degrade the preview.
  const res = await withFetch(
    (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch,
    () => ops().getPatchGroups(),
  );

  expect(res.status).toBe("error");
  expect(res).not.toHaveProperty("patchGroups");
});

test("a 401 says the api keys are wrong, not that there are no groups", async () => {
  const res = await withFetch(
    (async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    })) as unknown as typeof fetch,
    () => ops().getPatchGroups(),
  );

  expect(res.status).toBe("error");
  expect(res.status === "error" && res.message).toMatch(/api keys/i);
});

test("a malformed body is an error rather than a partly-parsed group", async () => {
  // A group whose `patchIds` did not arrive would silently scope a render to
  // fewer patches than the person staged, which reads as "my edit vanished".
  const res = await withFetch(
    (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ patchGroups: [{ patchGroupId: "group-alice" }] }),
    })) as unknown as typeof fetch,
    () => ops().getPatchGroups(),
  );

  expect(res.status).toBe("error");
});
