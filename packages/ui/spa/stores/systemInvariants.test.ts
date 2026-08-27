import { initVal } from "@valbuild/core";
import { externalPatch, initTestSystem, mfp, sp } from "./testSystem";
import { createSystem } from "./createSystem";
import { SchemaValidator } from "../validation/validateModule";

/**
 * Pinpointed reproductions, one invariant per test.
 *
 * Each is deliberately the smallest sequence that breaks ONE claim made in
 * `architecture.md` or in a comment in the stores, so a failure names the claim
 * rather than the flow that happened to reach it. They are separate `it`s and
 * not one flow precisely so that fixing one does not hide the next.
 *
 * The claim under test is quoted in each test's comment.
 */
describe("source store: which fields get woken", () => {
  /**
   * CLAIM (`architecture.md`, invariant 4): "A field whose path was not touched
   * is never invoked — not 'invoked and returns early'. That is what makes 'this
   * field got no messages' a guarantee rather than an accident."
   *
   * A guarantee about who is NOT woken is only sound if everyone whose value
   * changed IS woken. Inserting into an array shifts every later index, so the
   * value at `tags[1]` changes without `tags[1]` appearing in any op path.
   */
  it("wakes a later array index when an insert shifts it", async () => {
    const { c, s } = initVal();
    const { sourceStore, stat, listeners, ledger, dispose } = initTestSystem();

    await sourceStore.testReceive([
      c.define("/t.val.ts", s.object({ tags: s.array(s.string()) }), {
        tags: ["a", "b", "c"],
      }),
    ]);
    const tag1 = listeners.set('/t.val.ts?p="tags".1');
    const quiet = await tag1.noMessages();

    stat.simulateExternal([
      externalPatch("ins-1", "/t.val.ts", [
        { op: "add", path: ["tags", "0"], value: "zero" },
      ]),
    ]);
    await ledger.has({ type: "source:patch-apply", success: ["ins-1"] });

    // The store now holds "a" at tags[1] where it held "b".
    expect(await sourceStore.get('/t.val.ts?p="tags".1', null)).toMatchObject({
      status: "resolved-head",
      data: "a",
    });

    await tag1.didReceive({ type: "external-patch" }, { since: quiet });
    dispose();
  });

  /**
   * Same claim, the other direction: a removal shifts later indexes down.
   */
  it("wakes a later array index when a remove shifts it", async () => {
    const { c, s } = initVal();
    const { sourceStore, stat, listeners, ledger, dispose } = initTestSystem();

    await sourceStore.testReceive([
      c.define("/t.val.ts", s.object({ tags: s.array(s.string()) }), {
        tags: ["a", "b", "c"],
      }),
    ]);
    const tag1 = listeners.set('/t.val.ts?p="tags".1');
    const quiet = await tag1.noMessages();

    stat.simulateExternal([
      externalPatch("rm-1", "/t.val.ts", [
        { op: "remove", path: ["tags", "0"] },
      ]),
    ]);
    await ledger.has({ type: "source:patch-apply", success: ["rm-1"] });

    expect(await sourceStore.get('/t.val.ts?p="tags".1', null)).toMatchObject({
      status: "resolved-head",
      data: "c",
    });

    await tag1.didReceive({ type: "external-patch" }, { since: quiet });
    dispose();
  });
});

describe("source store: a patch that arrives before its module", () => {
  /**
   * CLAIM (`SourceStore.applyPatches`, on skipping an unloaded module): "Not a
   * failure: `receive()` rebuilds from base + chain, so this patch lands as soon
   * as the module arrives."
   *
   * `receive()` assigns base source and emits `source:init`. It does not re-apply
   * anything, and `appliedIds` is written but never read.
   */
  it("applies the patch once the module arrives", async () => {
    const { c, s } = initVal();
    const { sourceStore, stat, ledger, dispose } = initTestSystem();

    stat.simulateExternal([
      externalPatch("early-1", "/late.val.ts", [
        { op: "replace", path: ["headline"], value: "patched" },
      ]),
    ]);
    await ledger.has({ type: "patch:receive", patches: ["early-1"] });

    await sourceStore.testReceive([
      c.define("/late.val.ts", s.object({ headline: s.string() }), {
        headline: "as authored",
      }),
    ]);

    expect(
      await sourceStore.get('/late.val.ts?p="headline"', null),
    ).toMatchObject({ status: "resolved-head", data: "patched" });
    dispose();
  });

  /**
   * CLAIM (`types.ts`, on `HeadStatus`): `partial` means "the id is known but the
   * data has not arrived, or has not been applied yet".
   *
   * Once the data HAS arrived and the module IS loaded, the head has to settle.
   * A head that stays `partial` forever means no reader can ever observe the
   * system as up to date.
   */
  it("settles the head to complete once the module arrives", async () => {
    const { c, s } = initVal();
    const { sourceStore, patchStore, stat, ledger, dispose } = initTestSystem();

    stat.simulateExternal([
      externalPatch("early-2", "/late.val.ts", [
        { op: "replace", path: ["headline"], value: "patched" },
      ]),
    ]);
    await ledger.has({ type: "patch:receive", patches: ["early-2"] });
    await sourceStore.testReceive([
      c.define("/late.val.ts", s.object({ headline: s.string() }), {
        headline: "as authored",
      }),
    ]);

    expect(await patchStore.getHead()).toMatchObject({
      type: "external-complete",
    });
    dispose();
  });

  /**
   * CLAIM (`openquestions.md`, item 10): "`source:patch-apply` can emit with
   * everything empty. The early return only covers `records.length === 0`."
   *
   * Listed there as an open question; pinned here so the answer is recorded as a
   * test rather than as prose. An event that says nothing happened is one every
   * downstream consumer has to defend against.
   */
  it("does not announce an apply in which nothing applied", async () => {
    const { stat, ledger, dispose } = initTestSystem();
    const before = ledger.position();

    stat.simulateExternal([
      externalPatch("early-3", "/never-loaded.val.ts", [
        { op: "replace", path: ["headline"], value: "patched" },
      ]),
    ]);
    await ledger.has({ type: "patch:receive" }, { since: before });

    const emptyApplies = ledger.entries
      .slice(before)
      .filter(
        (event) =>
          event.type === "source:patch-apply" &&
          event.success.length === 0 &&
          event.failed.length === 0 &&
          event.modules.length === 0,
      );
    expect(emptyApplies).toEqual([]);
    dispose();
  });
});

describe("source store: re-intake", () => {
  /**
   * CLAIM (`HostStore.receive`): "Re-callable: HMR re-runs this with new
   * instances for the same paths."
   *
   * This is the known `no rebase` gap in `architecture.md`, pinned as a test
   * because the observable effect is silent loss of the user's pending edit —
   * worse than the "HMR will break" the doc records.
   */
  it("keeps a pending local edit when the module is re-received", async () => {
    const { c, s } = initVal();
    const { sourceStore, patchStore, dispose } = initTestSystem();

    const module = (title: string) =>
      c.define("/t.val.ts", s.object({ title: s.string() }), { title });

    await sourceStore.testReceive([module("authored")]);
    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "user edit" },
    ]);
    expect(await sourceStore.get('/t.val.ts?p="title"', null)).toMatchObject({
      status: "resolved-head",
      data: "user edit",
    });

    // HMR: the same module comes back, its base text edited in the editor.
    await sourceStore.testReceive([module("authored, then edited on disk")]);

    expect(await sourceStore.get('/t.val.ts?p="title"', null)).toMatchObject({
      status: "resolved-head",
      data: "user edit",
    });
    dispose();
  });
});

describe("patch set store: ordering in the review list", () => {
  /**
   * CLAIM (`PatchSetStore.insert`): "`PatchSets` orders by this, so a missing
   * timestamp must not sort as the epoch and bury a real edit at the bottom of
   * the review list."
   *
   * The line the comment is attached to passes `new Date(0).toISOString()`, and
   * `PatchStore.createPatch` never sets `createdAt` — so every local edit is
   * timestamped at the epoch.
   */
  it("does not timestamp a local edit at the epoch", async () => {
    const { c, s } = initVal();
    const { sourceStore, patchStore, getPatchSets, dispose } = initTestSystem();

    await sourceStore.testReceive([
      c.define("/t.val.ts", s.object({ title: s.string() }), {
        title: "authored",
      }),
    ]);
    const local = await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "user edit" },
    ]);

    const patchSets = await getPatchSets();
    const set = patchSets.find((candidate) =>
      candidate.patches.some((patch) => patch.patchId === local.patchId),
    );
    if (set === undefined) {
      throw new Error("the local patch is not in the review list at all");
    }
    expect(set.lastUpdated).not.toEqual(new Date(0).toISOString());
    dispose();
  });
});

describe("patch set store: an incremental grouping is the same grouping", () => {
  const project = () => {
    const { c, s } = initVal();
    return [
      c.define("/a.val.ts", s.object({ title: s.string(), body: s.string() }), {
        title: "a title",
        body: "a body",
      }),
      c.define("/b.val.ts", s.object({ title: s.string() }), {
        title: "b title",
      }),
    ];
  };

  /** Comparable across two systems: patch ids differ, the shape must not. */
  const shapeOf = (
    sets: Awaited<
      ReturnType<ReturnType<typeof initTestSystem>["getPatchSets"]>
    >,
  ) =>
    sets.map((set) => ({
      moduleFilePath: set.moduleFilePath,
      patchPath: set.patchPath,
      patches: set.patches.length,
      opTypes: [...set.opTypes].sort(),
      schemaTypes: [...set.schemaTypes].sort(),
    }));

  /**
   * THE invariant. `PatchSets.insert` merges and re-orders patch sets based on
   * the order things arrive in, so "insert the delta" is only sound if it lands
   * in the same place a full insert would have. Everything else in this file is
   * about when to rebuild; this is about whether appending is allowed to exist.
   *
   * Built two ways from the same edits: one system reading the grouping after
   * every patch (so every read after the first is an append), one reading it only
   * at the end (one rebuild). The groupings must agree.
   */
  it("matches a from-scratch build of the same chain", async () => {
    const edits: [string, string[], string][] = [
      ["/a.val.ts", ["title"], "one"],
      ["/b.val.ts", ["title"], "two"],
      ["/a.val.ts", ["body"], "three"],
      ["/a.val.ts", ["title"], "four"],
      ["/b.val.ts", ["title"], "five"],
    ];

    const incremental = initTestSystem();
    await incremental.sourceStore.testReceive(project());
    for (const [module, path, value] of edits) {
      await incremental.patchStore.createPatch(module, [
        { op: "replace", path, value },
      ]);
      // Read after every edit, so all but the first read is an append.
      await incremental.getPatchSets();
    }
    const appended = shapeOf(await incremental.getPatchSets());
    incremental.dispose();

    const wholesale = initTestSystem();
    await wholesale.sourceStore.testReceive(project());
    for (const [module, path, value] of edits) {
      await wholesale.patchStore.createPatch(module, [
        { op: "replace", path, value },
      ]);
    }
    const rebuilt = shapeOf(await wholesale.getPatchSets());
    wholesale.dispose();

    expect(appended).toEqual(rebuilt);
    // Guard against the assertion passing because both are empty, which would
    // make the whole test vacuous.
    expect(rebuilt.length).toBeGreaterThan(0);
  });

  /**
   * The chain is not append-only. `stat` is the authority on order, so another
   * session's patch can land BETWEEN two of ours — and `PatchSets` has no
   * removal, so a grouping built by appending after that would be ordered
   * differently from the chain. `PatchSetChain`'s prefix test is what catches it,
   * and it catches it without anyone having enumerated this case.
   */
  it("rebuilds when a foreign patch lands inside the chain", async () => {
    const {
      sourceStore,
      patchStore,
      stat,
      getPatchSets,
      activity,
      ledger,
      dispose,
    } = initTestSystem();
    await sourceStore.testReceive(project());
    const ours = await patchStore.createPatch("/a.val.ts", [
      { op: "replace", path: ["title"], value: "ours" },
    ]);
    await getPatchSets();

    // Stat announces a foreign patch, and `onStatPatchIds` adopts the server's
    // order wholesale — so ours moves to the tail behind it.
    stat.simulateExternal([
      externalPatch("theirs-1", "/b.val.ts", [
        { op: "replace", path: ["title"], value: "theirs" },
      ]),
    ]);
    // Waited for, not assumed. The chain handed to `PatchSetChain.plan` is
    // `allRecords()` — the patches whose OPS have arrived — so between the stat
    // and the fetch landing, the chain still looks like ours alone and the plan
    // is correctly `current`. It becomes a rebuild when the data lands, which is
    // the only point at which a rebuild could carry the foreign record anyway.
    await ledger.has({ type: "patch:receive" });
    const before = activity.position();
    const sets = await getPatchSets();

    // Two records re-inserted, not one appended: the whole chain.
    expect(activity.count("patch-set:insert", { since: before })).toBe(2);
    // And both patches are in the answer, which is what the rebuild was for.
    const ids = sets.flatMap((set) =>
      set.patches.map((patch) => patch.patchId),
    );
    expect(ids).toContain(ours.patchId);
    expect(ids).toContain(mfp("theirs-1"));
    dispose();
  });

  /**
   * A patch DROPPED from the chain — the server refused it permanently. The
   * grouping cannot remove it, so it has to be built again without it. Left
   * appending, the review list would keep offering a patch that no longer exists.
   */
  it("rebuilds after a patch is dropped from the chain", async () => {
    const { sourceStore, patchStore, getPatchSets, dispose } = initTestSystem();
    await sourceStore.testReceive(project());
    const kept = await patchStore.createPatch("/a.val.ts", [
      { op: "replace", path: ["title"], value: "kept" },
    ]);
    const doomed = await patchStore.createPatch("/b.val.ts", [
      { op: "replace", path: ["title"], value: "doomed" },
    ]);
    const beforeDrop = await getPatchSets();
    expect(
      beforeDrop.flatMap((set) => set.patches.map((patch) => patch.patchId)),
    ).toContain(doomed.patchId);

    patchStore.drop([doomed.patchId]);
    const afterDrop = await getPatchSets();

    const ids = afterDrop.flatMap((set) =>
      set.patches.map((patch) => patch.patchId),
    );
    expect(ids).toContain(kept.patchId);
    expect(ids).not.toContain(doomed.patchId);
    dispose();
  });

  /**
   * A schema replaced under patches that are otherwise untouched — HMR, or
   * `PUT /schema`. The prefix test cannot see this: the ids are identical. It
   * matters because patch sets are grouped using the schema at the op's path, so
   * what is already inserted was grouped against a schema that is gone.
   */
  it("rebuilds when a schema is replaced under existing patches", async () => {
    const { sourceStore, patchStore, getPatchSets, activity, dispose } =
      initTestSystem();
    await sourceStore.testReceive(project());
    await patchStore.createPatch("/a.val.ts", [
      { op: "replace", path: ["title"], value: "ours" },
    ]);
    await getPatchSets();

    const before = activity.position();
    // Re-intake is how a schema arrives again.
    await sourceStore.testReceive(project());
    await getPatchSets();

    expect(
      activity.count("patch-set:insert", { since: before }),
    ).toBeGreaterThan(0);
    dispose();
  });
});

describe("validation store", () => {
  /**
   * CLAIM (`ValidationStore.listenTo`): "A module is stale when its source
   * changed OR its schema changed. Both, or validation silently reports errors
   * against a schema that no longer exists."
   *
   * A control: this one should pass. It is here so a failure elsewhere in this
   * file cannot be read as "the rig cannot see validation at all".
   */
  it("recomputes after the source changes under a cached result", async () => {
    const { c, s } = initVal();
    const { sourceStore, patchStore, validationStore, dispose } =
      initTestSystem();

    await sourceStore.testReceive([
      c.define(
        "/t.val.ts",
        s.object({
          slug: s
            .string()
            .validate((src) =>
              src.includes(" ") ? "no spaces allowed" : false,
            ),
        }),
        { slug: "fine" },
      ),
    ]);

    const clean = await validationStore.validate(mfp("/t.val.ts"));
    expect(clean).toMatchObject({ errors: false, customValidateStatus: "ran" });

    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["slug"], value: "not fine" },
    ]);

    const dirty = await validationStore.validate(mfp("/t.val.ts"));
    if (dirty.status !== "validated" || dirty.errors === false) {
      throw new Error("expected an error after the source was made invalid");
    }
    expect(JSON.stringify(dirty.errors)).toContain("no spaces allowed");
    dispose();
  });
  /**
   * CLAIM (`ValidationStore.run`): a request is answered from source that has
   * not moved since — and a result computed from source that HAS moved is never
   * cached as current.
   *
   * Both halves of validation are awaited — the schema half across a WORKER
   * since `schemaValidationBridge.ts` — so an edit can land mid-flight. Clearing
   * `stale` unconditionally cached a result computed from the pre-edit source
   * and marked it current, and a field then showed errors for text the user had
   * already replaced.
   *
   * Marking it stale and stopping there was not enough either, and that was the
   * bug behind "typing an invalid value in the canvas shows no error at all":
   * `peek` answers stale with one shared object so repeated peeks are `===`, and
   * the reader re-asks from an effect keyed on the result it rendered — so
   * stale → raced → stale is the same object twice, the effect never re-runs,
   * and validation stops for that module until the field remounts. So the store
   * finishes the job itself.
   *
   * Both halves are pinned below: the intermediate result is not current, and
   * the answer the caller gets describes the edit.
   */
  it("recomputes when the source moves under a running validation", async () => {
    const { c, s } = initVal();
    /**
     * One gate per call into the bridge, so the test can stand between the two
     * passes. A queue rather than a flag: what is being asserted is that there
     * IS a second pass, which a single gate cannot observe.
     */
    const waiting: (() => void)[] = [];
    const validator = new SchemaValidator();
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
      createPatchId: (() => {
        let next = 0;
        return () => `stale-${++next}` as never;
      })(),
      schemaValidation: {
        async validate(moduleFilePath, source, serializedSchema, version) {
          await new Promise<void>((resolve) => waiting.push(resolve));
          return validator.validate(
            moduleFilePath,
            source,
            serializedSchema,
            version,
          );
        },
      },
    });
    // `minLength(4)`, so the two sources differ in whether they are VALID: the
    // pre-edit title passes and the edit does not. That is what makes "which
    // source did the answer describe" observable rather than inferred.
    system.host.receive([
      c.define("/t.val.ts", s.object({ title: s.string().minLength(4) }), {
        title: "Hello",
      }),
    ]);

    const until = async (predicate: () => boolean) => {
      for (let i = 0; i < 100 && !predicate(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(predicate()).toBe(true);
    };

    const running = system.validationStore.validate(mfp("/t.val.ts"));
    await until(() => waiting.length === 1);
    // The edit lands while the first validation is still inside the bridge.
    await system.patchStore.createPatch(mfp("/t.val.ts"), [
      { op: "replace", path: ["title"], value: "no" },
    ]);
    waiting.shift()?.();

    // A second pass, because the first one's answer was about source that has
    // since moved.
    await until(() => waiting.length === 1);
    // And in between, the pre-edit result is NOT served as current.
    expect(system.validationStore.peek(mfp("/t.val.ts"))).toMatchObject({
      status: "stale",
    });

    waiting.shift()?.();
    const result = await running;

    // The answer describes the edit: "no" is too short, "Hello" was not.
    if (result.status !== "validated" || result.errors === false) {
      throw new Error(
        `expected the recomputed result to carry the edit's error, got ${JSON.stringify(result)}`,
      );
    }
    expect(JSON.stringify(result.errors)).toContain(
      "at least 4 characters long",
    );
    // And it is current now, so the next reader is served from cache.
    expect(system.validationStore.peek(mfp("/t.val.ts"))).toBe(result);
    system.dispose();
  });
});

describe("source store: path matching at the edges", () => {
  /**
   * CLAIM (`pathMatch.ts`): "`changed` is an ANCESTOR of `path` — a patch
   * replaced the whole object my field lives in, so my value may have changed
   * underneath me."
   *
   * The extreme case of an ancestor is the module root, which is what a revert
   * or a `PUT /sources/~` result looks like: one op at `path: []`.
   */
  it("wakes a nested field when the module root is replaced", async () => {
    const { c, s } = initVal();
    const { sourceStore, stat, listeners, ledger, dispose } = initTestSystem();

    await sourceStore.testReceive([
      c.define("/t.val.ts", s.object({ title: s.string() }), {
        title: "authored",
      }),
    ]);
    const title = listeners.set('/t.val.ts?p="title"');
    const quiet = await title.noMessages();

    stat.simulateExternal([
      externalPatch("root-1", "/t.val.ts", [
        { op: "replace", path: [], value: { title: "reverted" } },
      ]),
    ]);
    await ledger.has({ type: "source:patch-apply", success: ["root-1"] });

    await title.didReceive({ type: "external-patch" }, { since: quiet });
    dispose();
  });

  /**
   * CLAIM (`pathMatch.ts`): "`ModuleFilePathSep` (`?p=`) separates the module
   * file path from the module path — so a listener registered on the bare module
   * file path is matched by anything inside it."
   */
  it("wakes a listener on the bare module file path", async () => {
    const { c, s } = initVal();
    const { sourceStore, stat, listeners, ledger, dispose } = initTestSystem();

    await sourceStore.testReceive([
      c.define("/t.val.ts", s.object({ title: s.string() }), {
        title: "authored",
      }),
    ]);
    const whole = listeners.set("/t.val.ts");
    const quiet = await whole.noMessages();

    stat.simulateExternal([
      externalPatch("mod-1", "/t.val.ts", [
        { op: "replace", path: ["title"], value: "changed" },
      ]),
    ]);
    await ledger.has({ type: "source:patch-apply", success: ["mod-1"] });

    await whole.didReceive({ type: "external-patch" }, { since: quiet });
    dispose();
  });

  /**
   * CLAIM (`openquestions.md`, item 2): "two field instances on the same path
   * must both update — the studio field and the inline overlay field are
   * different components showing one path."
   */
  it("wakes both listeners registered on one path", async () => {
    const { c, s } = initVal();
    const { sourceStore, stat, listeners, ledger, dispose } = initTestSystem();

    await sourceStore.testReceive([
      c.define("/t.val.ts", s.object({ title: s.string() }), {
        title: "authored",
      }),
    ]);
    const studio = listeners.set('/t.val.ts?p="title"');
    const overlay = listeners.set('/t.val.ts?p="title"');

    stat.simulateExternal([
      externalPatch("dual-1", "/t.val.ts", [
        { op: "replace", path: ["title"], value: "changed" },
      ]),
    ]);
    await ledger.has({ type: "source:patch-apply", success: ["dual-1"] });

    await studio.didReceive({ type: "external-patch" });
    await overlay.didReceive({ type: "external-patch" });
    dispose();
  });
});

describe("source store: patches that carry files", () => {
  const { c, s } = initVal();
  const imageModule = () =>
    c.define("/img.val.ts", s.object({ hero: s.image() }), {
      hero: {
        path: "/public/val/initial.png",
        width: 1,
        height: 1,
        mimeType: "image/png",
      },
    });

  /**
   * A `file` op is not a document mutation — the JSON patch ops cannot express
   * one and `applyPatch` rejects it outright — so the store applies the `replace`
   * that points source at the new file and ignores the `file` op beside it. The
   * bytes travel out of band: uploaded directly from the client before the patch
   * is sent, which is why the op's value is a hash and not data.
   */
  it("applies the json half of an image edit and wakes the field", async () => {
    const { sourceStore, stat, listeners, ledger, dispose } = initTestSystem();

    await sourceStore.testReceive([imageModule()]);
    const hero = listeners.set('/img.val.ts?p="hero"');
    const quiet = await hero.noMessages();

    stat.simulateExternal([
      externalPatch("img-1", "/img.val.ts", [
        {
          op: "replace",
          path: ["hero"],
          value: {
            _ref: "/public/val/uploaded.png",
            _type: "file",
            metadata: { width: 8, height: 1, mimeType: "image/png" },
          },
        },
        {
          op: "file",
          path: ["hero"],
          filePath: "/public/val/uploaded.png",
          // A HASH, never the bytes. See `splitPatchFileOps.ts`.
          value: "0a1b2c3d",
          remote: false,
        },
      ]),
    ]);
    await ledger.has({ type: "source:patch-apply", success: ["img-1"] });

    await hero.didReceive({ type: "external-patch" }, { since: quiet });
    const read = await sourceStore.get('/img.val.ts?p="hero"', null);
    expect(read).toMatchObject({
      status: "resolved-head",
      data: { _ref: "/public/val/uploaded.png" },
    });
    dispose();
  });

  /**
   * A file-only patch — a delete, or a re-upload of the same path — is reported
   * as applied although the store did nothing and knows nothing about whether the
   * upload happened.
   *
   * Pinned as the current behaviour rather than asserted as correct. It is
   * defensible: binaries are not the source store's business. But it is the same
   * silent shape as base64-in-a-file-op — the patch reports success and the file
   * may not exist — and this prototype has no upload path at all, so nothing in
   * it can currently tell the difference. See `openquestions.md`.
   */
  it("reports a file-only patch as applied, knowing nothing about the upload", async () => {
    const { sourceStore, patchStore, stat, ledger, dispose } = initTestSystem();

    await sourceStore.testReceive([imageModule()]);
    stat.simulateExternal([
      externalPatch("img-2", "/img.val.ts", [
        {
          op: "file",
          path: ["hero"],
          filePath: "/public/val/uploaded.png",
          value: null,
          remote: false,
        },
      ]),
    ]);

    await ledger.has({ type: "source:patch-apply", success: ["img-2"] });
    expect(await patchStore.getHead()).toMatchObject({
      type: "external-complete",
    });
    dispose();
  });
});

describe("peek is reference-stable in every store", () => {
  /**
   * CLAIM (`SourceStore.peek`, `ValidationStore.peek`, `RenderStore.peek`): all
   * three are "safe to call on a render path".
   *
   * That phrase has to mean reference-stable, or it means nothing. A
   * `useSyncExternalStore` consumer calls `getSnapshot` on every render and
   * compares the result with `Object.is`; a peek that builds a fresh object per
   * call therefore reports a change on every render and React re-renders until it
   * gives up — its own words were "maximum update depth exceeded". Two of the
   * three did exactly that, and it was invisible until a hook subscribed.
   *
   * One test per store, because they achieve it differently: source and render
   * recompute and compare, validation stores its result pre-wrapped.
   */
  const module = () => {
    const { c, s } = initVal();
    return c.define(
      "/t.val.ts",
      s.object({
        title: s.string(),
        rows: s.array(s.object({ n: s.string() })),
      }),
      { title: "a", rows: [{ n: "one" }] },
    );
  };

  it("source: an unchanged path peeks to the same object", async () => {
    const { sourceStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);

    expect(sourceStore.peek(sp("/t.val.ts"))).toBe(
      sourceStore.peek(sp("/t.val.ts")),
    );
    // And for a path that is not there, and for one inside an array — the three
    // shapes a field can be looking at.
    expect(sourceStore.peek(sp('/t.val.ts?p="nope"'))).toBe(
      sourceStore.peek(sp('/t.val.ts?p="nope"')),
    );
    expect(sourceStore.peek(sp('/t.val.ts?p="rows".0'))).toBe(
      sourceStore.peek(sp('/t.val.ts?p="rows".0')),
    );
    dispose();
  });

  it("validation: an unchanged module peeks to the same object", async () => {
    const { sourceStore, validationStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);
    await validationStore.validate(mfp("/t.val.ts"));

    expect(validationStore.peek(mfp("/t.val.ts"))).toBe(
      validationStore.peek(mfp("/t.val.ts")),
    );
    // A cache hit through `validate` must be the same object too: a consumer
    // holding one from either has to be able to compare them.
    expect(await validationStore.validate(mfp("/t.val.ts"))).toBe(
      validationStore.peek(mfp("/t.val.ts")),
    );
    dispose();
  });

  it("render: an unchanged path peeks to the same object", async () => {
    const { sourceStore, renderStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);
    await renderStore.get(sp('/t.val.ts?p="rows"'));

    expect(renderStore.peek(sp('/t.val.ts?p="rows"'))).toBe(
      renderStore.peek(sp('/t.val.ts?p="rows"')),
    );
    // Including the common "nothing here" answer, which is what most paths get
    // and therefore what most fields would have churned on.
    expect(renderStore.peek(sp('/t.val.ts?p="title"'))).toBe(
      renderStore.peek(sp('/t.val.ts?p="title"')),
    );
    dispose();
  });

  /**
   * And it must NOT be the same object once the answer changed, or a consumer
   * comparing references never repaints. The stability is only useful if it is
   * exact in both directions.
   */
  it("source: a changed path peeks to a different object", async () => {
    const { sourceStore, patchStore, dispose } = initTestSystem();
    await sourceStore.testReceive([module()]);
    const before = sourceStore.peek(sp("/t.val.ts"));

    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "b" },
    ]);

    expect(sourceStore.peek(sp("/t.val.ts"))).not.toBe(before);
    dispose();
  });

  it("validation: a module whose source moved peeks to a different object", async () => {
    const { sourceStore, patchStore, validationStore, dispose } =
      initTestSystem();
    await sourceStore.testReceive([module()]);
    const before = await validationStore.validate(mfp("/t.val.ts"));

    await patchStore.createPatch("/t.val.ts", [
      { op: "replace", path: ["title"], value: "b" },
    ]);

    // `stale` now, which is a different object AND a different status: the old
    // errors are about a value that has moved.
    expect(validationStore.peek(mfp("/t.val.ts"))).not.toBe(before);
    expect(validationStore.peek(mfp("/t.val.ts"))).toMatchObject({
      status: "stale",
    });
    dispose();
  });
});
