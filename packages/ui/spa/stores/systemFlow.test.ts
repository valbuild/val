import { initVal } from "@valbuild/core";
import { externalPatch, initTestSystem, mfp, patchIds } from "./testSystem";
import type { PatchRecord } from "./types";
import type { SerializedPatchSet } from "../utils/PatchSets";

/**
 * One long flow in the order a real session happens: intake, the user's own
 * edits, the review UI, validation, another session's edits, the review UI
 * again, search, and the patch chain at the end.
 *
 * It asserts the properties `architecture.md` CLAIMS, not the behaviour the code
 * happens to have — the point is to find out which of those claims the rig can
 * actually hold the system to.
 */

/** Does any patch set contain this patch id? */
function patchSetContaining(
  patchSets: SerializedPatchSet,
  patchId: string,
): SerializedPatchSet[number] | undefined {
  return patchSets.find((patchSet) =>
    patchSet.patches.some((patch) => patch.patchId === patchId),
  );
}

describe("system flow", () => {
  it("intake → local edits → patch sets → validation → external edits → patch sets → search → chain", async () => {
    const { c, s } = initVal();
    const {
      sourceStore,
      patchStore,
      stat,
      validationStore,
      getPatchSets,
      search,
      buildSearchIndex,
      ledger,
      listeners,
      dispose,
    } = initTestSystem();

    // ---------------------------------------------------------------- intake
    await sourceStore.testReceive([
      c.define(
        "/blogs.val.ts",
        s.object({
          title: s.string(),
          // A custom validator, so the host seam is exercised for real: the
          // validation store finds it by walking the SERIALIZED schema, and only
          // the host can run it, because only the host has the closure.
          slug: s
            .string()
            .validate((src) =>
              src.includes(" ") ? "slug must not contain spaces" : false,
            ),
          tags: s.array(s.string()),
        }),
        { title: "Hello", slug: "hello", tags: ["alpha", "beta", "gamma"] },
      ),
      c.define("/authors.val.ts", s.object({ name: s.string() }), {
        name: "Ada Lovelace",
      }),
    ]);

    await ledger.has({
      type: "host:receive",
      modules: ["/blogs.val.ts", "/authors.val.ts"],
    });
    await ledger.has({ type: "schema:init" });
    await ledger.has({ type: "source:init" });

    const emptyHead = await patchStore.getHead();
    expect(emptyHead).toMatchObject({ type: "empty" });
    // `null` on a first read: see the note in `system.test.ts` — the head is a
    // claim about what has been incorporated, and nothing has been yet.
    expect(
      await sourceStore.get('/blogs.val.ts?p="title"', null),
    ).toMatchObject({ status: "resolved-head", data: "Hello" });

    // Three listeners: the field the user edits, a SIBLING that must stay
    // asleep, and a field in another module that must also stay asleep.
    const titleListener = listeners.set('/blogs.val.ts?p="title"');
    const tag1Listener = listeners.set('/blogs.val.ts?p="tags".1');
    const authorListener = listeners.set('/authors.val.ts?p="name"');

    const quietAfterIntake = await tag1Listener.noMessages();
    await authorListener.noMessages();

    // ----------------------------------------------------- the user's edits
    const localTitle = await patchStore.createPatch(
      "/blogs.val.ts",
      [{ op: "replace", path: ["title"], value: "Hello World" }],
      { author: "local-user" },
    );
    await titleListener.didReceive({ type: "internal-patch" });
    // The user's own edit must not wake a sibling or another module.
    const quietAfterTitle = await tag1Listener.noMessages({
      since: quietAfterIntake,
    });
    await authorListener.noMessages();

    const headAfterLocal = await patchStore.getHead();
    expect(headAfterLocal).toMatchObject({
      type: "internal-complete",
      patchId: localTitle.patchId,
    });
    expect(
      await sourceStore.get('/blogs.val.ts?p="title"', null),
    ).toMatchObject({ status: "resolved-head", data: "Hello World" });

    // ------------------------------------------------- patch sets, first look
    const patchSetsAfterLocal = await getPatchSets();
    expect(
      patchSetContaining(patchSetsAfterLocal, localTitle.patchId),
    ).toBeDefined();

    // -------------------------------------------------------- validation
    // Nothing has validated yet: the whole point is that editing does not
    // validate. The first read is what computes.
    expect(validationStore.peek(mfp("/blogs.val.ts"))).toEqual({
      status: "stale",
    });

    const firstValidation = await validationStore.validate(
      mfp("/blogs.val.ts"),
    );
    expect(firstValidation).toMatchObject({
      status: "validated",
      // The module declares a custom validator and the host holds the instance,
      // so the custom half must actually have run.
      customValidateStatus: "ran",
    });
    expect(firstValidation).toMatchObject({ errors: false });

    // Now break the custom rule and confirm the error surfaces on re-read.
    const ledgerBeforeSlug = ledger.position();
    await patchStore.createPatch("/blogs.val.ts", [
      { op: "replace", path: ["slug"], value: "hello world" },
    ]);
    // Errors that someone was holding are now stale, and that IS news.
    await ledger.has(
      { type: "validation:invalidate", modules: ["/blogs.val.ts"] },
      { since: ledgerBeforeSlug },
    );

    const brokenValidation = await validationStore.validate(
      mfp("/blogs.val.ts"),
    );
    expect(brokenValidation).toMatchObject({
      status: "validated",
      customValidateStatus: "ran",
    });
    if (
      brokenValidation.status !== "validated" ||
      brokenValidation.errors === false
    ) {
      throw new Error("expected the custom validator to report an error");
    }
    expect(JSON.stringify(brokenValidation.errors)).toContain(
      "slug must not contain spaces",
    );

    // --------------------------------------------- another user's edits
    // Announced by /stat as ids only, so the ops have to be fetched — which is
    // what makes `external-partial` a state the system really passes through.
    const externalEdits = [
      externalPatch("ext-1", "/authors.val.ts", [
        { op: "replace", path: ["name"], value: "Grace Hopper" },
      ]),
      externalPatch("ext-2", "/blogs.val.ts", [
        { op: "replace", path: ["tags", "0"], value: "ALPHA" },
      ]),
    ] satisfies PatchRecord[];

    const ledgerBeforeExternal = ledger.position();
    stat.simulateExternal(externalEdits);
    await ledger.has({ type: "stat:receive" }, { since: ledgerBeforeExternal });
    await ledger.has(
      { type: "patch:receive", patches: patchIds(externalEdits) },
      { since: ledgerBeforeExternal },
    );
    await ledger.has(
      { type: "source:patch-apply", success: patchIds(externalEdits) },
      { since: ledgerBeforeExternal },
    );

    // Another session's edit IS news, in both modules.
    await authorListener.didReceive({ type: "external-patch" });
    expect(
      await sourceStore.get('/authors.val.ts?p="name"', null),
    ).toMatchObject({ status: "resolved-head", data: "Grace Hopper" });

    // A replace at tags[0] does not change tags[1], so the sibling stays asleep.
    const quietAfterTag0 = await tag1Listener.noMessages({
      since: quietAfterTitle,
    });

    // ---- the variation: an INSERT shifts every later index in the array ----
    // tags is ["ALPHA","beta","gamma"]; inserting at 0 makes tags[1] "ALPHA"
    // where it was "beta". The value at the registered path changed, so the
    // listener has to be woken — a field showing tags[1] is now displaying a
    // value the store no longer holds.
    stat.simulateExternal([
      externalPatch("ext-3", "/blogs.val.ts", [
        { op: "add", path: ["tags", "0"], value: "zeroth" },
      ]),
    ]);
    await ledger.has({ type: "source:patch-apply", success: ["ext-3"] });

    expect(
      await sourceStore.get('/blogs.val.ts?p="tags".1', null),
    ).toMatchObject({ status: "resolved-head", data: "ALPHA" });
    // THE CLAIM: "only registered paths are woken" is a guarantee about which
    // fields are woken, and it is only sound if every field whose VALUE changed
    // is among them.
    await tag1Listener.didReceive(
      { type: "external-patch" },
      { since: quietAfterTag0 },
    );

    // ------------------------------------------------ patch sets, second look
    const patchSetsAfterExternal = await getPatchSets();
    for (const record of externalEdits) {
      expect(
        patchSetContaining(patchSetsAfterExternal, record.patchId),
      ).toBeDefined();
    }
    // The review UI shows newest first, so a patch made now must not sort
    // behind one an external session made in the past.
    const localSet = patchSetContaining(
      patchSetsAfterExternal,
      localTitle.patchId,
    );
    if (localSet === undefined) {
      throw new Error("the local patch left the review list");
    }
    expect(localSet.lastUpdated).not.toEqual(new Date(0).toISOString());

    // ------------------------------------------------------------- search
    const built = await buildSearchIndex();
    expect(built.all).toContain("/blogs.val.ts");
    expect(built.all).toContain("/authors.val.ts");
    await ledger.has({ type: "search:build-index" });

    const found = await search("Grace");
    expect(found).toMatchObject({ status: "results" });
    if (found.status !== "results") {
      throw new Error("expected search results");
    }
    expect(found.results.length).toBeGreaterThan(0);
    expect(found.staleModules).toEqual([]);

    // An edit, then a query. The query RECONCILES rather than reporting itself
    // stale, so the stronger guarantee is available and this asserts that one:
    // the edited value is findable and the old one is gone.
    //
    // (An earlier version asserted `staleModules` contained the edited module.
    // That was true when a caller reached past the system into
    // `searchStore.search()` without a rebuild. Through `search()` the query
    // pays for the index first, so results are never behind — which is the point
    // of demand-driven indexing, and a better thing to hold the system to.)
    await patchStore.createPatch("/authors.val.ts", [
      { op: "replace", path: ["name"], value: "Radia Perlman" },
    ]);
    const afterEdit = await search("Radia");
    if (afterEdit.status !== "results") {
      throw new Error("expected search results");
    }
    expect(afterEdit.results.length).toBeGreaterThan(0);
    expect(afterEdit.staleModules).toEqual([]);
    const gone = await search("Grace");
    if (gone.status !== "results") {
      throw new Error("expected a result set");
    }
    expect(gone.results).toEqual([]);

    // -------------------------------------------------------------- the chain
    // A patch for a module that has not loaded yet. The source store skips it
    // "because `receive()` rebuilds from base + chain, so this patch lands as
    // soon as the module arrives" — so once the module arrives, it must be there.
    stat.simulateExternal([
      externalPatch("ext-4", "/late.val.ts", [
        { op: "replace", path: ["headline"], value: "patched before load" },
      ]),
    ]);
    // Not pinned to a one-element list: `/stat` announces the WHOLE ordered
    // chain every time, so by this point it carries every id in the session.
    await ledger.has({ type: "patch:receive", patches: ["ext-4"] });

    await sourceStore.testReceive([
      c.define("/late.val.ts", s.object({ headline: s.string() }), {
        headline: "as authored",
      }),
    ]);

    expect(
      await sourceStore.get('/late.val.ts?p="headline"', null),
    ).toMatchObject({ status: "resolved-head", data: "patched before load" });

    dispose();
  });
});
