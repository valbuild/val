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
 * (`RecordingActivity`), not timed, so CI can hold them. Catalogue ids B01,
 * B02. (B03, a draft read in a 128 MB isolate, is a benchmark, not here.)
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
});
