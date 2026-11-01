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
 * Readers: the page's loader, the page's hook and the Studio's field agreeing.
 * Catalogue ids S22, S23. (S24 is not built, and S25 is a unit test: see
 * the README.)
 */

const { s, c, config } = initVal({});
const homeVal = c.define(
  "/content/home.val.ts",
  s.object({ title: s.string() }),
  { title: "Hello" },
);
const title = { module: homeVal, field: ["title"] };

describe.each<ServerMode>(["memory", "fs", "http"])("on %s", (server) => {
  let world: World | null = null;
  afterEach(async () => {
    await world?.dispose();
    world = null;
  });

  /**
   * S22 fetchVal, useVal and the Studio agree.
   *
   * Given a draft page with the overlay, reading the title through a loader
   * and a hook, and the overlay's Studio field on the same title,
   * when edits arrive (two, from the overlay's own Studio),
   * then once the world is quiet all three show the same value.
   *
   * The plan's stronger form -- whenever two surfaces are at the same
   * VERSION they show the same value -- needs versions in the frames (phase
   * 1). Until then this is the end state, which is "converges".
   */
  test("S22 the loader, the hook and the Studio field agree", async () => {
    world = await createWorld({ config, modules: [homeVal], server });
    const page = await world.loadPage("/", {
      shows: [{ surface: "hook", ...title }],
      loaderShows: [{ surface: "loader", ...title }],
    });
    page.studio.reads("field", homeVal, ["title"]);
    await page.studio.edit(homeVal, ["title"], "One");
    await world.settle();
    await page.studio.edit(homeVal, ["title"], "Two");
    await world.settle();
    // The loader catches up with an edit only on a refresh after the write
    // has landed (S05), so give the page's safety net its tick.
    await world.clock.advance(10_000);
    await world.settle();
    await world.observe();

    expect([
      world.frames.last("hook"),
      world.frames.last("loader"),
      world.frames.last("field"),
    ]).toEqual(["Two", "Two", "Two"]);
  });

  /**
   * S23 Draft at SSR with no flash of published content.
   *
   * Given a pending edit,
   * when a TanStack page passing the draft prop is server-rendered and
   * hydrated in draft mode,
   * then the first frame already shows the draft, and no later frame shows
   * the published value.
   */
  test("S23 draft at SSR with no flash of published content", async () => {
    world = await createWorld({ config, modules: [homeVal], server });
    const editor = await world.studio("editor");
    await editor.edit(homeVal, ["title"], "Draft title");
    await world.settle();

    await world.loadPage("/", {
      shows: [{ surface: "hook", ...title }],
      loaderShows: [{ surface: "loader", ...title }],
    });
    await world.settle();

    const hook = world.frames.of("hook").map((frame) => frame.value);
    expect(hook[0]).toBe("Draft title"); // the server render
    expect(hook).not.toContain("Hello");
    expect(world.frames.of("loader")[0]?.value).toBe("Draft title");
  });
});
