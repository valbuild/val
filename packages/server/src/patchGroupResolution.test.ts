import { PatchId } from "@valbuild/core";
import { ValOpsHttp } from "./ValOpsHttp";
import type { ModuleFilePath } from "@valbuild/core";

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
  /*
   * `branch` asserted, not incidental. The endpoint answers 400 without it, and
   * the first version of this test pinned the URL WITHOUT it — so the test
   * encoded the bug instead of catching it, and a lookup that always failed
   * looked verified.
   */
  expect(calls).toEqual([
    `https://content.val.build/v1/${PROJECT}/patch-groups?branch=main`,
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

/**
 * Group membership travels WITH the patch, in one request.
 *
 * Atomic on purpose: the content API runs every refusal before its insert, so
 * an invalid closure is a 400 with nothing written. Recording membership in a
 * second call would let a patch exist outside its author's group whenever that
 * call failed — and a patch outside your own group is one you cannot publish
 * until a repair puts it back.
 *
 * `saveSourceFilePatch` is `protected`, so this reaches it through a subclass
 * rather than a cast: the signature is a real seam of this class and a cast
 * would stop it being checked, which is the part worth keeping.
 */
class ExposedValOpsHttp extends ValOpsHttp {
  saveForTest(
    patchGroup?: Parameters<ValOpsHttp["createPatch"]>[6],
  ): Promise<unknown> {
    return this.createPatch(
      "/a.val.ts" as ModuleFilePath,
      [{ op: "replace", path: ["title"], value: "x" }],
      "p1" as PatchId,
      { type: "head", headBaseSha: "sha" as never },
      null,
      "alice" as never,
      patchGroup,
    );
  }
}

function exposedOps(): ExposedValOpsHttp {
  return new ExposedValOpsHttp(
    "https://content.val.build",
    PROJECT,
    "commit-sha",
    "main",
    { apiKey: "key" },
    { modules: [] } as never,
  );
}

/** The body of the one POST the save made. */
async function bodyOfSave(
  patchGroup?: Parameters<ValOpsHttp["createPatch"]>[6],
): Promise<Record<string, unknown>> {
  const bodies: string[] = [];
  await withFetch(
    (async (url: string, init?: { body?: string }) => {
      if (String(url).endsWith("/patches") && init?.body) {
        bodies.push(init.body);
        return { ok: true, status: 200, json: async () => ({ patchId: "p1" }) };
      }
      // Everything else this path touches (base sha, and so on).
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch,
    () => exposedOps().saveForTest(patchGroup),
  );
  const body = bodies[bodies.length - 1];
  if (!body) throw new Error("no POST /patches was made");
  return JSON.parse(body) as Record<string, unknown>;
}

test("sends the group id and the client's closure with the patch", async () => {
  const body = await bodyOfSave({
    patchGroupId: "group-alice",
    alsoAddPatchIds: ["p0" as PatchId],
    closureVersion: 3,
  });

  expect(body.patchGroupId).toBe("group-alice");
  expect(body.alsoAddPatchIds).toEqual(["p0"]);
  expect(body.closureVersion).toBe(3);
  // Same request as the patch, not a follow-up.
  expect(body.patchId).toBe("p1");
});

/*
 * There is deliberately no test for "omits `patchGroupId` when the membership
 * has none".
 *
 * `JSON.stringify` drops `undefined` keys, so a body built with the key set to
 * `undefined` and one built without the key at all are byte-identical. The
 * assertion would pass whichever way the code is written, which makes it a test
 * that cannot fail. What the client must not do — hold a group id across
 * publishes and send a stale one — is enforced where the id is produced, in
 * `ValShell`'s resolver, not here.
 */
test("omits the group fields entirely when there is no group", async () => {
  const body = await bodyOfSave(undefined);

  // Absent, not null. An older content API validates the shape it knows, and
  // explicit nulls are a different thing to it than missing keys.
  expect("patchGroupId" in body).toBe(false);
  expect("alsoAddPatchIds" in body).toBe(false);
  expect("closureVersion" in body).toBe(false);
});

/**
 * What comes BACK, which is the only way the client can learn its group.
 *
 * The write names no group on purpose — the content API resolves this author's
 * open one and creates it if absent — so on a fresh branch the group comes into
 * existence in this response and nowhere else. The chain annotation refreshes
 * only when a fetch has missing ids to ask for, and a patch this client made is
 * never missing, so a dropped id here is a tab that can never stage anything.
 */
async function savedGroupId(
  responseJson: Record<string, unknown>,
): Promise<string | undefined> {
  const res = await withFetch(
    (async (url: string, init?: { body?: string }) => {
      if (String(url).endsWith("/patches") && init?.body) {
        return { ok: true, status: 200, json: async () => responseJson };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch,
    () =>
      exposedOps().saveForTest({
        alsoAddPatchIds: [],
        closureVersion: 1,
      }),
  );
  if (
    typeof res !== "object" ||
    res === null ||
    !("value" in res) ||
    typeof res.value !== "object" ||
    res.value === null
  ) {
    throw new Error(`save did not succeed: ${JSON.stringify(res)}`);
  }
  const value = res.value;
  if (!("patchGroupId" in value)) {
    return undefined;
  }
  const patchGroupId: unknown = value.patchGroupId;
  if (typeof patchGroupId !== "string") {
    throw new Error(`patchGroupId was not a string: ${String(patchGroupId)}`);
  }
  return patchGroupId;
}

/**
 * A content API that PREDATES patch groups answers 404, and that is not a
 * failure — it is "there are no groups here".
 *
 * The distinction decides what a draft render shows. `/sources/~` reads an
 * error as "could not ask" and renders BASE, so folding 404 into error made
 * every existing http deployment silently drop all pending content from every
 * draft preview — the opposite of the "keeps working unchanged" this feature
 * promises, and invisible to whoever is looking at the page.
 */
test("a missing patch-groups endpoint reads as unsupported, not as an error", async () => {
  const res = await withFetch(
    (async () =>
      ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ message: "Not found" }),
        text: async () => "Not found",
      }) as unknown as Response) as unknown as typeof fetch,
    () => ops().getPatchGroups(),
  );
  expect(res.status).toBe("unsupported");
});

test("a real failure is still an error, so the caller can degrade", async () => {
  // 401/500/network all mean the endpoint is THERE and did not answer. Base is
  // the honest render for those; unscoped would leak other authors' drafts.
  for (const status of [401, 500]) {
    const res = await withFetch(
      (async () =>
        ({
          ok: false,
          status,
          statusText: "Nope",
          json: async () => ({}),
          text: async () => "nope",
        }) as unknown as Response) as unknown as typeof fetch,
      () => ops().getPatchGroups(),
    );
    expect(res.status).toBe("error");
  }
});

test("reports the group the content API put the patch in", async () => {
  expect(
    await savedGroupId({ patchId: "p1", patchGroupId: "group-alice" }),
  ).toBe("group-alice");
});

test("a content API that predates groups still saves, with no group", async () => {
  // The field is optional in the response schema for exactly this: an older
  // content API answers without it, and the save must succeed rather than fail
  // to parse. Absent, so the client reads it as "no groups here".
  expect(await savedGroupId({ patchId: "p1" })).toBe(undefined);
});
