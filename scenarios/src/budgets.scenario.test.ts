import { initVal } from "@valbuild/core";
import { createWorld, type ServerMode, type World } from "./world/createWorld";

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
 * readers' B07 (`read:resolve`, `read:encode`). (B03, a draft
 * read in a 128 MB isolate, is a benchmark, not here.)
 */

const { s, c, config } = initVal({});
const homeVal = c.define(
  "/content/home.val.ts",
  s.object({ title: s.string(), subtitle: s.string() }),
  { title: "Hello", subtitle: "Sub" },
);

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
   * then the patch is applied once, one module is cloned for it, and the echo
   * applies nothing again.
   *
   * The plan's target is lower (copy-on-write: nothing outside the patch's
   * path cloned); today's `applyPatch(deepClone(module))` costs one clone per
   * patch, which is the budget held here so it cannot get worse.
   */
  test("B01 a keystroke applies its patch once, even after the echo", async () => {
    world = await createWorld({ config, modules: [homeVal], server });
    const editor = await world.studio("editor");
    await world.settle();
    const since = editor.work.position();

    await editor.edit(homeVal, ["title"], "Typed");
    await world.settle();

    editor.expectWork(since, {
      "source:apply-patch": { exactly: 1 },
      "source:clone-module": { atMost: 1 },
    });
  });

  /**
   * B02 Another editor's keystroke.
   *
   * Given two editors on one module,
   * when one types once,
   * then the other applies that one patch once, fetches it once (GET
   * /patches), and never fetches the whole module (PUT /sources/~).
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
      "source:clone-module": { atMost: 1 },
    });
    const bos = world.network.log
      .slice(logSince)
      .filter((e) => e.from === "studio:bo")
      .map((e) => `${e.method} ${e.path}`);
    expect(bos.filter((r) => r === "GET /api/val/patches")).toHaveLength(1);
    expect(bos).not.toContain("PUT /api/val/sources/~");
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

    await world.observe();
    await world.manifest();
    await world.manifest();
    await world.clock.advance(25_000); // the Studio's next /stat, at least
    await world.settle();

    world.expectWork(since, { "version:hash": { exactly: 0 } });
  });

  /**
   * B05 A keystroke costs one link of the chain.
   *
   * Given a Studio on a module, read once,
   * when the editor types once and everything reads it again,
   * then one version is hashed: the module's chain extended by the new
   * patch, once for every reader in the process (they share one data layer,
   * `sharedValOps`). Nothing else moved: not a schema, not a base.
   */
  test("B05 a keystroke costs one link of the chain", async () => {
    world = await createWorld({ config, modules: [homeVal], server });
    const editor = await world.studio("editor");
    const page = world.page("/", { draftMode: true });
    page.reads("loader", async (val) => (await val.fetchVal(homeVal)).title);
    await world.settle();
    await world.observe();
    const since = world.workPosition();

    await editor.edit(homeVal, ["title"], "Typed");
    await world.settle();
    await world.observe();
    await world.manifest();

    world.expectWork(since, { "version:hash": { exactly: 1 } });
  });

  /**
   * B06 The engine copies along a patch's path, not the module.
   *
   * Given a module with a title and a list of 200 items, read in draft mode,
   * when the editor types into the title and everything reads it again,
   * then every time the server's engine applies that patch it copies the
   * module's root (two references) and nothing else: the 200 items are
   * shared with the base (risk 4 in the plan, `engine:clone-bytes`). And
   * when the editor then types into one item, applying THAT patch copies
   * the root, the list and the one item: its path, however long the rest is.
   * Before copy-on-write each patch cloned the whole module.
   */
  test("B06 a keystroke copies only along its path", async () => {
    world = await createWorld({ config, modules: [listVal], server });
    const editor = await world.studio("editor");
    const page = world.page("/", { draftMode: true });
    page.reads("loader", async (val) => (await val.fetchVal(listVal)).title);
    await world.settle();
    await world.observe();

    const beforeTitle = world.workPosition();
    await editor.edit(listVal, ["title"], "Typed");
    await world.settle();
    await world.observe();
    const afterTitle = world.workPosition();
    const titleApplies = afterTitle.engineApplies - beforeTitle.engineApplies;
    expect(titleApplies).toBeGreaterThan(0);
    /** The root: `title` and `items`. */
    const rootBytes = 8 * 2;
    world.expectWork(beforeTitle, {
      "engine:clone-bytes": { exactly: titleApplies * rootBytes },
    });

    await editor.edit(listVal, ["items", "150", "name"], "Renamed");
    await world.settle();
    await world.observe();
    const applies =
      world.workPosition().engineApplies - afterTitle.engineApplies;
    // Every read now applies the chain: the title's patch, then the item's.
    expect(applies % 2).toBe(0);
    const reads = applies / 2;
    expect(reads).toBeGreaterThan(0);
    /** The root, the list's 200 references, and the item's two fields. */
    const itemBytes = rootBytes + 8 * ITEMS + 8 * 2;
    world.expectWork(afterTitle, {
      "engine:apply-patch": { exactly: reads * 2 },
      "engine:clone-bytes": { exactly: reads * (rootBytes + itemBytes) },
    });
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
});
