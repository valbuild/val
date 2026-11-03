import { initVal } from "@valbuild/core";
import { createWorld, type World } from "./world/createWorld";

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
 * S06 `/stat` answers out of order. http mode only: in fs and memory a
 * Studio has one `/stat` in flight at a time and it is a long poll, so an
 * answer is computed when something changed, never before it -- there is no
 * early answer to deliver late (see the README). In http mode `/stat` is
 * asked on an interval, beside the writes, and the content service versions
 * the chain (`headVersion`), which is what an answer can be older than.
 */

const { s, c, config } = initVal({});
const homeVal = c.define(
  "/content/home.val.ts",
  s.object({ title: s.string() }),
  { title: "Hello" },
);

/** The interval at which a Studio with a socket asks `/stat` (`useStatus`). */
const STAT_INTERVAL_MS = 20 * 60 * 1000;

describe("on http", () => {
  let world: World | null = null;
  afterEach(async () => {
    await world?.dispose();
    world = null;
  });

  /**
   * Given a Studio whose next `/stat` is answered from the chain as it was
   * BEFORE an edit, and delivered after the edit was saved,
   * then the late answer does not take the edit back: the Studio's field and
   * the page's draft read show it at the end, neither goes back on the way,
   * and the Studio shows no error.
   */
  test("S06 a /stat answer computed before an edit and delivered after it", async () => {
    world = await createWorld({ config, modules: [homeVal], server: "http" });
    const editor = await world.studio("editor");
    editor.reads("field", homeVal, ["title"]);
    const page = world.page("/", { draftMode: true });
    page.reads("loader", async (val) => (await val.fetchVal(homeVal)).title);
    await world.settle();
    await world.observe();

    // The interval's `/stat`: answered now, and held on its way back.
    world.network.hold({
      path: "/api/val/stat",
      from: "studio:editor",
      at: "answer",
    });
    await world.clock.advance(STAT_INTERVAL_MS + 1000);
    await world.settle();
    const held = () =>
      world?.network.log.filter(
        (e) => e.path === "/api/val/stat" && e.status === "held",
      ) ?? [];
    expect(held()).toHaveLength(1);
    const late = world.network.log.at(-1);
    expect(late).toMatchObject({ path: "/api/val/stat", status: "held" });

    await editor.edit(homeVal, ["title"], "Edited");
    await world.settle();
    await world.observe();
    world.network.release();
    await world.settle();
    expect(held()).toHaveLength(0);
    await world.observe();

    world.expectInvariants();
    expect(world.frames.last("field")).toBe("Edited");
    expect(world.frames.last("loader")).toBe("Edited");
    expect(editor.errors()).toEqual([]);
  });
});
