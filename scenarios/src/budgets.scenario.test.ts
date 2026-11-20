import { Internal, initVal } from "@valbuild/core";
import {
  EMPTY_CHAIN,
  moduleKey,
  type ModuleVersion,
} from "@valbuild/shared/internal";
import {
  createWorld,
  moduleFilePathOf,
  type ServerMode,
  type World,
} from "./world/createWorld";

// See `smoke.scenario.test.ts` and the README for these two.
jest.mock(
  "@tanstack/react-start/server",
  () => jest.requireActual("./world/tanstackStart"),
  { virtual: true },
);
jest.mock("../../packages/ui/spa/validation/schemaValidationBridge", () =>
  jest.requireActual("./world/noWorkerBridge"),
);

/**
 * Budgets: work counted with the stores' own activity channel
 * (`RecordingActivity`), and versions hashed with `versionHashCount`, not
 * timed, so CI can hold them. Catalogue ids B01, B02, B04, B05, and the
 * engine's B06 (`engine:apply-patch`, `engine:clone-bytes`), and the
 * readers' B07 (`read:resolve`, `read:encode`), and a draft page's
 * refreshes, B08, and the versions a Studio keeps, B09, and what a
 * manifest since the last one names, B10; and the head's (phase 6): what it
 * holds, B11, what a request's reads cost it, B12, what the module
 * endpoint sends, B13, and what an entry request costs, B14. (B03, a draft read in a 128 MB isolate, is a
 * benchmark, not here.)
 *
 * Since phase 5 a Studio applies patches with the same engine as the server
 * and computes its own versions, in the same process: `world.expectWork`
 * counts the server's work and the readers', and `studio.expectWork` a
 * Studio's (its `source:apply-patch` is the engine's apply, its
 * `engine:clone-bytes` and `version:hash` what the engine copied and what it
 * hashed for it).
 */

const { s, c, config } = initVal({});
const homeVal = c.define(
  "/content/home.val.ts",
  s.object({ title: s.string(), subtitle: s.string() }),
  { title: "Hello", subtitle: "Sub" },
);
const HOME = moduleFilePathOf(homeVal);

/** A `.jsonValues()` record of `size` entries, each its own import. */
function notesOf(path: string, size: number) {
  const note = (i: number) =>
    c.json(
      (): Promise<{ default: { title: string } }> =>
        Promise.resolve({ default: { title: `Note ${i}` } }),
    );
  const entries: Record<string, ReturnType<typeof note>> = {};
  for (let i = 0; i < size; i++) {
    entries[`note-${i}`] = note(i);
  }
  return c.define(
    path as `/${string}.val.ts`,
    s.record(s.object({ title: s.string() })).jsonValues(),
    entries,
  );
}
const smallNotes = notesOf("/content/small-notes.val.ts", 20);
const largeNotes = notesOf("/content/large-notes.val.ts", 5_000);

const ITEMS = 200;
const listVal = c.define(
  "/content/list.val.ts",
  s.object({
    title: s.string(),
    items: s.array(s.object({ name: s.string(), body: s.string() })),
  }),
  {
    title: "List",
    items: Array.from({ length: ITEMS }, (_, i) => ({
      name: `Item ${i}`,
      body: `The body of item ${i}, long enough to be worth sharing.`,
    })),
  },
);

describe.each<ServerMode>(["memory", "fs", "http"])("on %s", (server) => {
  let world: World | null = null;
  afterEach(async () => {
    await world?.dispose();
    world = null;
  });

  /**
   * B01 A keystroke's cost.
   *
   * Given a Studio with a module,
   * when the editor types once (one patch) and the server echoes it back
   * through /stat,
   * then the patch is applied once (risk 2 in the plan: one engine apply per
   * keystroke), no module is cloned -- the engine copies the module's root,
   * two references, and shares the rest -- and one version is hashed, the
   * chain one link longer; the echo applies and hashes nothing again. And the
   * version the Studio showed the edit at before the server had it is the
   * version the server answers for it: confirming it is not a change.
   *
   * Before phase 5 the Studio cloned the module for every patch
   * (`applyPatch(deepClone(module))`), which this held at most one.
   */
  test("B01 a keystroke applies its patch once, even after the echo", async () => {
    world = await createWorld({ config, modules: [homeVal], server });
    const editor = await world.studio("editor");
    await world.settle();
    const since = editor.work.position();

    await editor.edit(homeVal, ["title"], "Typed");
    const optimistic = editor.system.sourceStore.versionOf(HOME);
    await world.settle();

    editor.expectWork(since, {
      "source:apply-patch": { exactly: 1 },
      "source:clone-module": { exactly: 0 },
      "engine:clone-bytes": { exactly: 8 * 2 },
      "version:hash": { exactly: 1 },
    });
    expect(optimistic).toBeDefined();
    expect(editor.system.sourceStore.versionOf(HOME)).toEqual(optimistic);
    expect((await world.manifest()).modules[HOME]).toEqual(optimistic);
  });

  /**
   * B02 Another editor's keystroke.
   *
   * Given two editors on one module,
   * when one types once,
   * then the other applies that one patch once, fetches it once (GET
   * /patches), and never fetches the whole module (PUT /sources/~) -- nor
   * the module's patches again (GET /modules): the version the manifest
   * names is the held one with the record the patch store fetched on top.
   * Where `/stat` told it (fs, memory), the manifest came on that answer, so
   * the only other request is the next `/stat`; where a socket message did
   * (http), the manifest is asked for.
   */
  test("B02 another editor's keystroke costs one patch, not the module", async () => {
    world = await createWorld({ config, modules: [homeVal], server });
    const ada = await world.studio("ada");
    const bo = await world.studio("bo");
    await world.settle();
    const since = bo.work.position();
    const logSince = world.network.log.length;

    await ada.edit(homeVal, ["title"], "From Ada");
    await world.settle();

    bo.expectWork(since, {
      "source:apply-patch": { exactly: 1 },
      "source:clone-module": { exactly: 0 },
      "engine:clone-bytes": { exactly: 8 * 2 },
      "version:hash": { exactly: 1 },
    });
    const bos = world.network.log
      .slice(logSince)
      .filter((e) => e.from === "studio:bo")
      .map((e) => `${e.method} ${e.path}`);
    expect(bos.filter((r) => r === "GET /api/val/patches")).toHaveLength(1);
    expect(bos).not.toContain("PUT /api/val/sources/~");
    expect([...bos].sort()).toEqual(
      server === "http"
        ? ["GET /api/val/manifest", "GET /api/val/patches"]
        : ["GET /api/val/patches", "POST /api/val/stat"],
    );
  });

  /**
   * B04 Reading hashes no version.
   *
   * Given a module with pending edits, read once since they landed,
   * when a draft page's loader reads it, the editor's Studio asks /stat, and
   * the manifest is asked twice,
   * then no version is hashed: every one was computed when the content
   * changed (risk 3 in the plan, `version:hash` per read = 0).
   */
  test("B04 reading hashes no version", async () => {
    world = await createWorld({ config, modules: [homeVal], server });
    const editor = await world.studio("editor");
    editor.reads("field", homeVal, ["title"]);
    const page = world.page("/", { draftMode: true });
    page.reads("loader", async (val) => (await val.fetchVal(homeVal)).title);
    await editor.edit(homeVal, ["title"], "One");
    await editor.edit(homeVal, ["subtitle"], "Two");
    await world.settle();
    await world.observe();
    const since = world.workPosition();
    const studioSince = editor.work.position();

    await world.observe();
    await world.manifest();
    await world.manifest();
    await world.clock.advance(25_000); // the Studio's next /stat, at least
    await world.settle();

    world.expectWork(since, { "version:hash": { exactly: 0 } });
    // The Studio's reads too: its field, its relay's version, its /stat.
    editor.expectWork(studioSince, { "version:hash": { exactly: 0 } });
  });

  /**
   * B05 A keystroke costs one link of the chain.
   *
   * Given a Studio on a module, read once,
   * when the editor types once and everything reads it again,
   * then one version is hashed on the server: the module's chain extended
   * by the new patch, once for every reader in the process (they share one
   * runtime, `valRuntime`); and one in the Studio, which computes the
   * version of what it shows (phase 5). Nothing else moved: not a schema, not
   * a base.
   */
  test("B05 a keystroke costs one link of the chain", async () => {
    world = await createWorld({ config, modules: [homeVal], server });
    const editor = await world.studio("editor");
    const page = world.page("/", { draftMode: true });
    page.reads("loader", async (val) => (await val.fetchVal(homeVal)).title);
    await world.settle();
    await world.observe();
    const since = world.workPosition();
    const studioSince = editor.work.position();

    await editor.edit(homeVal, ["title"], "Typed");
    await world.settle();
    await world.observe();
    await world.manifest();

    world.expectWork(since, { "version:hash": { exactly: 1 } });
    editor.expectWork(studioSince, { "version:hash": { exactly: 1 } });
  });

  /**
   * B10 A manifest since the last one names what moved, and nothing else.
   *
   * Given a project of two modules and the manifest a client holds,
   * when nothing moves, then asking "since `seq` N" with it is a 304 (risk
   * 10 in the plan: a quiet project sends nothing); and when one module is
   * edited, the answer names that module alone, as a delta from N, at the
   * version the whole manifest names for it -- and hashes nothing beyond the
   * write's own link.
   */
  test("B10 a manifest since the last one names only what moved", async () => {
    world = await createWorld({ config, modules: [homeVal, listVal], server });
    const editor = await world.studio("editor");
    await world.settle();
    const held = await world.manifest();
    expect(await world.manifest(held)).toBeNull();

    await editor.edit(homeVal, ["title"], "Typed");
    await world.settle();
    const whole = await world.manifest();
    const since = world.workPosition();
    const delta = await world.manifest(held);
    world.expectWork(since, { "version:hash": { exactly: 0 } });

    expect(delta?.since).toBe(held.project.seq);
    expect(Object.keys(delta?.modules ?? {})).toEqual([HOME]);
    expect(delta?.modules[HOME]).toEqual(whole.modules[HOME]);
    expect(delta?.project).toEqual(whole.project);
  });

  /**
   * B11 The head grows with what was edited, and keeps two versions.
   *
   * Given a project of two modules, one of them 200 items long, both read
   * by a draft page,
   * when nothing is edited, then the head holds nothing: an unpatched module
   * is the reader's own bundle, and nothing is made for it;
   * and when the editor types forty times into the small one, then the head
   * holds that module alone, two versions of it (the one shown and the one
   * before: `HEAD_VERSIONS_PER_MODULE`), and no more bytes than the copied
   * roots and the typed values -- never the 200 items (risk 11 in the plan,
   * the isolate's 128 MB).
   */
  test("B11 the head holds what was edited, two versions of it", async () => {
    world = await createWorld({ config, modules: [homeVal, listVal], server });
    const editor = await world.studio("editor");
    const page = world.page("/", { draftMode: true });
    page.reads("home", async (val) => (await val.fetchVal(homeVal)).title);
    page.reads("list", async (val) => (await val.fetchVal(listVal)).title);
    await world.settle();
    await world.observe();
    expect(await world.head()).toMatchObject({
      bytes: 0,
      versions: 0,
      modules: 0,
    });

    for (let i = 1; i <= 40; i++) {
      await editor.edit(homeVal, ["title"], `Typed ${i}`);
      await world.settle();
      await world.observe();
    }
    expect(world.frames.last("home")).toBe("Typed 40");
    const head = await world.head();
    expect(head.modules).toBe(1);
    expect(head.mostVersionsOfOneModule).toBe(2);
    // Two versions, each the root (two references) and the title typed.
    expect(head.bytes).toBeLessThanOrEqual(2 * (8 * 2 + 16));
  });

  /**
   * B12 A request's reads ask the head once each, and read the chain once.
   *
   * Given a draft page that reads three modules' worth in one request (three
   * `fetchVal`s and the draft for the provider),
   * when nothing moved since the last request, then each read asks the head
   * "has the chain moved?" once (`seq`), and nothing reads the chain or
   * makes a module (before phase 6 each request read the whole tree,
   * previewed and validated it, and asked `/patches` and `/json` again for
   * the draft);
   * and when the editor typed once in between, the chain is read once --
   * by whichever asks first: since phase 7 that is usually the editor's own
   * Studio, whose manifest read after the save goes through the same head --
   * and the one module that moved is made once, by the request.
   */
  test("B12 a request's reads ask the head once each, and read the chain once", async () => {
    world = await createWorld({ config, modules: [homeVal, listVal], server });
    const editor = await world.studio("editor");
    const page = world.page("/", { draftMode: true });
    page.reads("title", async (val) => (await val.fetchVal(homeVal)).title);
    page.reads("sub", async (val) => (await val.fetchVal(homeVal)).subtitle);
    page.reads("list", async (val) => (await val.fetchVal(listVal)).title);
    await editor.edit(homeVal, ["title"], "Typed");
    await world.settle();
    await world.observe();

    const quiet = world.workPosition();
    await world.observe();
    world.expectWork(quiet, {
      "head:seq": { atMost: 3 },
      "head:chain": { exactly: 0 },
      "head:materialize": { exactly: 0 },
      "engine:apply-patch": { exactly: 0 },
    });

    const typed = world.workPosition();
    await editor.edit(homeVal, ["subtitle"], "Typed too");
    await world.settle();
    const moved = world.workPosition();
    await world.observe();
    world.expectWork(moved, {
      "head:seq": { atMost: 3 },
      "head:chain": { atMost: 1 },
    });
    world.expectWork(typed, {
      "head:chain": { exactly: 1 },
      "head:materialize": { exactly: 1 },
      "engine:apply-patch": { exactly: 1 },
    });
    expect(world.frames.last("sub")).toBe("Typed too");
  });

  /**
   * B13 The module endpoint sends what moved.
   *
   * Given a module of 200 items and a client holding its version,
   * when the editor types once into one item, then `GET /modules` with the
   * version the client holds (`have`) answers the one patch, and none of the
   * module -- a small fraction of the whole answer (risk 1 in the plan: a
   * pull costs the patch, as the chain replay it replaces did); without
   * `have` it answers the whole module, at the version the manifest names;
   * a base is read by its version (the empty chain); and a version the
   * server does not hold is a 404 that says which one it does.
   */
  test("B13 the module endpoint answers a keystroke with the keystroke", async () => {
    world = await createWorld({ config, modules: [listVal], server });
    const editor = await world.studio("editor");
    await world.settle();
    const LIST = moduleFilePathOf(listVal);
    const before = (await world.manifest()).modules[LIST];
    if (before === undefined) throw new Error("no version of the list");

    await editor.edit(listVal, ["items", "150", "name"], "Renamed");
    await world.settle();
    const after = (await world.manifest()).modules[LIST];
    if (after === undefined) throw new Error("no version of the list");

    const whole = await world.modules(listVal);
    expect(whole.status).toBe(200);
    expect(whole.json).toMatchObject({ kind: "module", version: after });

    const delta = await world.modules(listVal, {
      have: moduleKey(LIST, before),
    });
    expect(delta.status).toBe(200);
    expect(delta.json).toMatchObject({
      kind: "delta",
      from: before,
      to: after,
    });
    const patches = (delta.json as { patches: unknown[] }).patches;
    expect(patches).toHaveLength(1);
    expect(delta.bytes * 20).toBeLessThan(whole.bytes);

    const base: ModuleVersion = { ...after, chain: EMPTY_CHAIN };
    const byBase = await world.modules(listVal, { v: moduleKey(LIST, base) });
    expect(byBase.status).toBe(200);
    expect(byBase.json).toMatchObject({ kind: "module", version: base });
    expect(
      (byBase.json as { source: { items: { name: string }[] } }).source
        .items[150]?.name,
    ).toBe("Item 150");

    const unknown = await world.modules(listVal, {
      v: moduleKey(LIST, { ...after, chain: "not-a-chain" }),
    });
    expect(unknown.status).toBe(404);
    expect(unknown.json).toMatchObject({ current: after });
  });

  /**
   * B14 An entry request costs the entries it asks for, whatever the
   * record's size.
   *
   * Given two `.jsonValues()` records, of 20 entries and of 5,000, one entry
   * of each edited,
   * when a client asks for 20 entries of each, one request per entry and
   * then all 20 in one request, the server's patches applied and not (the
   * Studio's `apply_patches=false`),
   * then neither record's keys are walked more than once (each record object
   * once, ever: `recordKeysOf`), and the head resolves each entry once per
   * version -- the same work for the record of 5,000 as for the one of 20.
   * Before, every `GET /json` walked the whole record, so reading every
   * entry one request at a time was quadratic (phase 10's baseline).
   */
  test("B14 an entry request costs the entries it asks for, not the record", async () => {
    world = await createWorld({
      config,
      modules: [smallNotes, largeNotes],
      server,
    });
    const editor = await world.studio("editor");
    await world.settle();
    await editor.edit(smallNotes, ["note-3", "title"], "Edited");
    await editor.edit(largeNotes, ["note-3", "title"], "Edited");
    await world.settle();
    const keys = Array.from({ length: 20 }, (_, i) => `note-${i}`);

    const work = async (module: typeof smallNotes) => {
      const since = world!.workPosition();
      for (const applyPatches of [true, false]) {
        for (const key of keys) {
          const one = await world!.jsonEntries(module, [key], { applyPatches });
          expect(one.status).toBe(200);
        }
        const all = await world!.jsonEntries(module, keys, { applyPatches });
        expect(all.status).toBe(200);
        expect(
          (all.json as { entries: { key: string }[] }).entries.map(
            (entry) => entry.key,
          ),
        ).toEqual(keys);
      }
      return since;
    };
    const small = await work(smallNotes);
    world.expectWork(small, {
      "head:record-scan": { atMost: 2 },
      "head:entry-resolve": { atMost: keys.length },
    });
    const large = await work(largeNotes);
    world.expectWork(large, {
      "head:record-scan": { atMost: 2 },
      "head:entry-resolve": { atMost: keys.length },
    });
    const edited = await world.jsonEntries(largeNotes, ["note-3"]);
    expect(edited.json).toMatchObject({
      entries: [{ key: "note-3", content: { title: "Edited" } }],
    });
  });

  /**
   * B06 The engine copies along a patch's path, not the module -- and the
   * head applies a patch once, however often it is read.
   *
   * Given a module with a title and a list of 200 items, read in draft mode,
   * when the editor types into the title and everything reads it again,
   * then the server's engine applies that patch ONCE (the head makes the
   * module's new version once and every read after is answered from it,
   * phase 6) and copies the module's root (two references) and nothing
   * else: the 200 items are shared with the base (risk 4 in the plan,
   * `engine:clone-bytes`). And when the editor then types into one item,
   * the head EXTENDS the version before by that one patch -- the title's is
   * not applied again -- copying the root, the list and the one item: its
   * path, however long the rest is. Before copy-on-write each patch cloned
   * the whole module; before the head every read applied the whole chain.
   */
  test("B06 a keystroke copies only along its path", async () => {
    world = await createWorld({ config, modules: [listVal], server });
    const editor = await world.studio("editor");
    const page = world.page("/", { draftMode: true });
    page.reads("loader", async (val) => (await val.fetchVal(listVal)).title);
    await world.settle();
    await world.observe();

    const beforeTitle = world.workPosition();
    const studioBeforeTitle = editor.work.position();
    await editor.edit(listVal, ["title"], "Typed");
    await world.settle();
    await world.observe();
    await world.observe();
    const afterTitle = world.workPosition();
    /** The root: `title` and `items`. */
    const rootBytes = 8 * 2;
    world.expectWork(beforeTitle, {
      "engine:apply-patch": { exactly: 1 },
      "engine:clone-bytes": { exactly: rootBytes },
    });
    // The Studio, through the same engine: once, its root.
    editor.expectWork(studioBeforeTitle, {
      "source:apply-patch": { exactly: 1 },
      "engine:clone-bytes": { exactly: rootBytes },
    });

    const studioBeforeItem = editor.work.position();
    await editor.edit(listVal, ["items", "150", "name"], "Renamed");
    await world.settle();
    await world.observe();
    await world.observe();
    expect(world.frames.last("loader")).toBe("Typed");
    /** The root, the list's 200 references, and the item's two fields. */
    const itemBytes = rootBytes + 8 * ITEMS + 8 * 2;
    world.expectWork(afterTitle, {
      "engine:apply-patch": { exactly: 1 },
      "engine:clone-bytes": { exactly: itemBytes },
    });
    // The Studio applies the new patch alone, on the version before it.
    editor.expectWork(studioBeforeItem, {
      "source:apply-patch": { exactly: 1 },
      "engine:clone-bytes": { exactly: itemBytes },
    });
  });

  /**
   * B09 A Studio keeps the last two versions of a module, and no more.
   *
   * Given a Studio on a module,
   * when the editor types forty times,
   * then each keystroke is one apply and its store holds two versions of the
   * module -- the one shown and the one before it -- not forty (risk 9 in the
   * plan, the heap guard); and when the newest edit is discarded, the
   * version before it is shown again without applying anything.
   */
  test("B09 a Studio keeps the last two versions of a module", async () => {
    world = await createWorld({ config, modules: [homeVal], server });
    const editor = await world.studio("editor");
    await world.settle();
    const since = editor.work.position();
    let last: Awaited<ReturnType<typeof editor.edit>> | null = null;
    for (let i = 1; i <= 40; i++) {
      last = await editor.edit(homeVal, ["title"], `Typed ${i}`);
    }
    await world.settle();
    editor.expectWork(since, {
      "source:apply-patch": { exactly: 40 },
      // A manifest a stat carried decides at the moment that stat was asked:
      // a save confirmed after it is not gone for being missing from it.
      "patch:drop": { exactly: 0 },
    });
    expect(editor.system.sourceStore.retainedVersions(HOME)).toBe(2);
    const before = editor.system.sourceStore.versionOf(HOME);

    const discarding = editor.work.position();
    if (last === null) throw new Error("no edit");
    expect(await editor.discard([last])).toEqual({ status: "discarded" });
    await world.settle();

    editor.expectWork(discarding, { "source:apply-patch": { exactly: 0 } });
    expect(editor.system.sourceStore.retainedVersions(HOME)).toBe(2);
    expect(editor.system.sourceStore.versionOf(HOME)).not.toEqual(before);
    const title = editor.system.sourceStore.peek(
      Internal.joinModuleFilePathAndModulePath(
        HOME,
        Internal.patchPathToModulePath(["title"]),
      ),
    );
    expect(title.status === "ready" && title.data).toBe("Typed 39");
  });

  /**
   * B07 A read resolves once per wait, and encodes once.
   *
   * Given a module with a pending edit,
   * when a draft page's loader reads it (`fetchVal`), and a visitor's does,
   * then the draft read resolves twice -- once to find the draft is loading,
   * once when it is in -- and the visitor's once, with nothing to wait for;
   * and each encodes its value exactly once (risk 6 in the plan: edit tags
   * are woven in once per read, never once per wait). Every reader of both
   * frameworks resolves through `resolveVal`, so this is all of them.
   */
  test("B07 a read resolves once per wait, and encodes once", async () => {
    world = await createWorld({ config, modules: [homeVal], server });
    const editor = await world.studio("editor");
    const draft = world.page("/", { draftMode: true });
    draft.reads("draft", async (val) => (await val.fetchVal(homeVal)).title);
    await editor.edit(homeVal, ["title"], "Typed");
    await world.settle();

    const beforeDraft = world.workPosition();
    await world.observe();
    world.expectWork(beforeDraft, {
      "read:resolve": { exactly: 2 },
      "read:encode": { exactly: 1 },
    });
    expect(world.frames.last("draft")).toBe("Typed");

    const visitor = world.page("/", { draftMode: false });
    visitor.reads(
      "visitor",
      async (val) => (await val.fetchVal(homeVal)).title,
    );
    const beforeVisitor = world.workPosition();
    await world.observe();
    // The draft page reads again (2 and 1), and the visitor once.
    world.expectWork(beforeVisitor, {
      "read:resolve": { exactly: 2 + 1 },
      "read:encode": { exactly: 1 + 1 },
    });
    expect(world.frames.last("visitor")).toBe("Hello");
  });

  /**
   * B08 A draft page re-reads its server once per confirmed edit, and never
   * on the clock ("events, not timers").
   *
   * Given a draft page with the overlay, rendered from the server's draft
   * (the `draft` prop), reading the title through a loader,
   * when the overlay's Studio types twice, waiting for each to be saved,
   * then the loaders re-ran exactly twice -- once per version the server
   * confirmed (`confirmed`, `startRefreshLoop`) -- and not for the page
   * connecting, whose render already had what the Studio holds; another
   * editor's change, once the server has it, is one more; and a minute of
   * nothing is none. Before phase 4 a refresh went out on every relayed
   * change (racing the write, S05) and a safety refresh every ten seconds
   * for thirty seconds after an edit.
   */
  test("B08 a draft page refreshes once per confirmed edit, and never on the clock", async () => {
    world = await createWorld({ config, modules: [homeVal], server });
    const page = await world.loadPage("/", {
      shows: [{ surface: "hook", module: homeVal, field: ["title"] }],
      loaderShows: [{ surface: "loader", module: homeVal, field: ["title"] }],
    });
    await world.settle();
    expect(page.refreshes).toBe(0);

    await page.studio.edit(homeVal, ["title"], "One");
    await world.settle();
    expect(page.refreshes).toBe(1);
    await page.studio.edit(homeVal, ["title"], "Two");
    await world.settle();
    expect(page.refreshes).toBe(2);
    expect(world.frames.last("loader")).toBe("Two");

    const other = await world.studio("other");
    await other.edit(homeVal, ["subtitle"], "Theirs");
    await world.settle();
    expect(page.refreshes).toBe(3);

    await world.clock.advance(60_000);
    await world.settle();
    expect(page.refreshes).toBe(3);
  });

  /**
   * B08 A page loaded without the `draft` prop, with an edit already
   * pending, is behind what the Studio holds: one refresh when the overlay
   * connects, and none after.
   */
  test("B08 a page rendered without the draft refreshes once when the overlay connects", async () => {
    world = await createWorld({ config, modules: [homeVal], server });
    const editor = await world.studio("editor");
    await editor.edit(homeVal, ["title"], "Pending");
    await world.settle();
    const page = await world.loadPage("/", {
      shows: [{ surface: "hook", module: homeVal, field: ["title"] }],
      loaderShows: [{ surface: "loader", module: homeVal, field: ["title"] }],
      draftProp: false,
    });
    await world.settle();
    await world.clock.advance(60_000);
    await world.settle();
    expect(page.refreshes).toBe(1);
    expect(world.frames.last("loader")).toBe("Pending");
    expect(world.frames.last("hook")).toBe("Pending");
  });
});
