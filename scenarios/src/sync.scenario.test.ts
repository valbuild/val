import { initVal } from "@valbuild/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
 * Writes and sync: the patch chain, discards, publishing, and how the page
 * learns of each. Catalogue ids S05, S07, S08, S09.
 */

const { s, c, config } = initVal({});
const PATH = "/content/home.val.ts";
const homeVal = c.define(
  PATH,
  s.object({ title: s.string(), subtitle: s.string() }),
  { title: "Hello", subtitle: "Sub" },
);
/** The module's file, for what reads text: a publish rewrites it. */
const HOME_TEXT = `import { c, s } from "../val.config";

export default c.define(
  "${PATH}",
  s.object({ title: s.string(), subtitle: s.string() }),
  { title: "Hello", subtitle: "Sub" },
);
`;

const title = { module: homeVal, field: ["title"] };
const subtitle = { module: homeVal, field: ["subtitle"] };

describe.each<ServerMode>(["memory", "fs"])("on %s", (server) => {
  let world: World | null = null;
  afterEach(async () => {
    await world?.dispose();
    world = null;
  });

  /**
   * S08 The write after a discard names a parent the server still holds.
   *
   * Given a saved edit that is then discarded,
   * when the editor makes another edit,
   * then it is saved on the first try, nothing is reverted, and the Studio
   * shows no error. (A shipped bug: one discard poisoned every later edit
   * until a reload -- `architecture/quirks.md`.)
   */
  test("S08 the write after a discard is saved", async () => {
    world = await createWorld({ config, modules: [homeVal], server });
    const editor = await world.studio("editor");
    const page = world.page("/", { draftMode: true });
    page.reads("loader", async (val) => (await val.fetchVal(homeVal)).title);

    const first = await editor.edit(homeVal, ["title"], "First");
    await world.settle();
    expect(await editor.discard([first])).toEqual({ status: "discarded" });
    await world.settle();
    await editor.edit(homeVal, ["title"], "Second");
    await world.settle();
    await world.observe();

    expect(world.frames.last("loader")).toBe("Second");
    expect(editor.errors()).toEqual([]);
    const deletes = world.network.log.filter((e) => e.method === "DELETE");
    expect(deletes).toHaveLength(1); // the discard, and nothing after it
  });

  /**
   * S07 A discard in the middle of the chain reaches every reader.
   *
   * Given edits to the title, then the subtitle, shown on a draft page with
   * the overlay (a hook and a loader for each field) and in the editor's
   * fields,
   * when the title edit is discarded -- the newest patch stays the
   * subtitle's,
   * then every surface shows the original title and the new subtitle.
   *
   * "Never goes back" does not apply: the title really does go back. Until
   * frames carry versions (phase 1), the end state is what is checked.
   */
  test("S07 a discard in the middle of the chain reaches every reader", async () => {
    world = await createWorld({ config, modules: [homeVal], server });
    const editor = await world.studio("editor");
    editor.reads("field title", homeVal, ["title"]);
    editor.reads("field subtitle", homeVal, ["subtitle"]);
    await world.loadPage("/", {
      shows: [
        { surface: "hook title", ...title },
        { surface: "hook subtitle", ...subtitle },
      ],
      loaderShows: [
        { surface: "loader title", ...title },
        { surface: "loader subtitle", ...subtitle },
      ],
    });

    const titleEdit = await editor.edit(homeVal, ["title"], "New title");
    await editor.edit(homeVal, ["subtitle"], "New sub");
    await world.settle();
    await world.observe();
    expect(lastOf(world, "hook title", "loader title", "field title")).toEqual([
      "New title",
      "New title",
      "New title",
    ]);

    expect(await editor.discard([titleEdit])).toEqual({ status: "discarded" });
    await world.settle();
    await world.observe();

    expect(lastOf(world, "hook title", "loader title", "field title")).toEqual([
      "Hello",
      "Hello",
      "Hello",
    ]);
    expect(
      lastOf(world, "hook subtitle", "loader subtitle", "field subtitle"),
    ).toEqual(["New sub", "New sub", "New sub"]);
  });

  /**
   * S05 A refresh that lands before the write does not hide the edit.
   *
   * Given a draft page with the overlay, showing the title through a hook and
   * through a loader,
   * when the overlay's Studio saves an edit while its PUT /patches is held,
   * the page's refresh loop re-runs the loaders, and then the write is let
   * through,
   * then every surface ends on the edit without the 10 s safety refresh
   * ("events, not timers").
   *
   * SKIPPED: fails today, by design of the current loop. The edit reaches the
   * page's store at once, which re-runs the loaders -- against a server that
   * does not have the write yet, so the loader shows the old title. When the
   * write lands, nothing tells the page (the store did not change again), so
   * the loader stays old until the safety net's next tick. The test below
   * pins that. Plan: phase 4 ("confirmed up to this version" triggers the
   * refresh).
   */
  test.skip("S05 a refresh that lands before the write does not hide the edit", async () => {
    world = await createWorld({ config, modules: [homeVal], server });
    await refreshBeforeWrite(world);
    world.frames.expectInvariants();
  });

  test("S05 why: the loader re-runs before the write and only the safety net catches up", async () => {
    world = await createWorld({ config, modules: [homeVal], server });
    const page = await refreshBeforeWrite(world);
    expect(world.frames.last("hook")).toBe("Hello world");
    // Re-run while the write was held, and nothing re-ran it after.
    expect(world.frames.last("loader")).toBe("Hello");
    const refreshesBefore = page.refreshes;
    // The safety net's tick (10 s) is what brings the edit across.
    await world.clock.advance(10_000);
    await world.settle();
    expect(page.refreshes).toBeGreaterThan(refreshesBefore);
    expect(world.frames.last("loader")).toBe("Hello world");
  });

  /**
   * S09 A publish while a draft page is open.
   *
   * Given a pending edit shown on a draft page with the overlay,
   * when the editor publishes it,
   * then the page never shows the old content again, and the module's file
   * holds the new value.
   */
  test("S09 a publish while a draft page is open", async () => {
    world = await createWorld({
      config,
      modules: [homeVal],
      server,
      sourceText: { [PATH]: HOME_TEXT },
    });
    const editor = await world.studio("editor");
    await world.loadPage("/", {
      shows: [{ surface: "hook", ...title }],
      loaderShows: [{ surface: "loader", ...title }],
    });
    await editor.edit(homeVal, ["title"], "Published title");
    await world.settle();

    const published = await editor.publish();
    expect(published.status).toBe("published");
    await world.settle();

    world.frames.expectNeverGoesBack();
    expect(world.frames.last("hook")).toBe("Published title");
    expect(world.frames.last("loader")).toBe("Published title");
    if (world.server.mode === "fs") {
      expect(readFileSync(join(world.server.root, PATH), "utf8")).toContain(
        "Published title",
      );
    }
  });
});

function lastOf(world: World, ...surfaces: string[]): unknown[] {
  return surfaces.map((surface) => world.frames.last(surface));
}

/** S05's steps: load, hold the write, edit, let the loop refresh, release. */
async function refreshBeforeWrite(world: World) {
  const page = await world.loadPage("/", {
    shows: [{ surface: "hook", ...title }],
    loaderShows: [{ surface: "loader", ...title }],
  });
  await world.settle();
  world.network.hold({ method: "PUT", path: "/api/val/patches" });
  await page.studio.edit(homeVal, ["title"], "Hello world");
  await world.clock.advance(1_000); // the relay's debounce, and the loop's refresh
  world.network.release();
  await world.settle();
  return page;
}
