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
 * timed, so CI can hold them. Catalogue ids B01, B02, B04, B05. (B03, a draft
 * read in a 128 MB isolate, is a benchmark, not here.)
 */

const { s, c, config } = initVal({});
const homeVal = c.define(
  "/content/home.val.ts",
  s.object({ title: s.string(), subtitle: s.string() }),
  { title: "Hello", subtitle: "Sub" },
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
});
