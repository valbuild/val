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

describe.each<ServerMode>(["memory", "fs", "http"])("on %s", (server) => {
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
   * then every surface shows the original title and the new subtitle, and
   * none of them went back.
   *
   * The title's VALUE goes back, and that is not going back: it comes back
   * at a chain no surface has shown (the subtitle's patch alone), which the
   * frames' versions say (phase 1). Before them only the end state could be
   * checked.
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
    world.frames.expectNeverGoesBack();
  });

  /**
   * S05 A refresh that lands before the write does not hide the edit.
   *
   * Given a draft page with the overlay, showing the title through a hook and
   * through a loader,
   * when the overlay's Studio saves an edit while its PUT /patches is held,
   * and then the write is let through,
   * then every surface ends on the edit, with no timer involved ("events,
   * not timers").
   *
   * It failed before phase 4: the edit reached the page's store at once,
   * which re-ran the loaders against a server that did not have the write
   * yet, so the loader showed the old title; when the write landed nothing
   * told the page, and only the safety refresh, ten seconds on, caught up.
   * Now the page re-reads its server when the Studio says the server has
   * CONFIRMED the edit (`confirmed`, with the server's `seq`), and the
   * safety refresh is gone. So nothing is re-read while the write is held,
   * and exactly once after it lands.
   */
  test("S05 a refresh that lands before the write does not hide the edit", async () => {
    world = await createWorld({ config, modules: [homeVal], server });
    const { page, refreshesWhileHeld } = await refreshBeforeWrite(world);
    world.frames.expectInvariants();
    expect(world.frames.last("hook")).toBe("Hello world");
    expect(world.frames.last("loader")).toBe("Hello world");
    // Not while the server did not have it: that refresh would only bring
    // the old title back.
    expect(refreshesWhileHeld).toBe(0);
    // One refresh for the one confirmed edit...
    expect(page.refreshes).toBe(1);
    // ...and none from the clock, however long the page stays open.
    await world.clock.advance(60_000);
    await world.settle();
    expect(page.refreshes).toBe(1);
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

/** S05's steps: load, hold the write, edit, let the relay run, release. */
async function refreshBeforeWrite(world: World) {
  const page = await world.loadPage("/", {
    shows: [{ surface: "hook", ...title }],
    loaderShows: [{ surface: "loader", ...title }],
  });
  await world.settle();
  world.network.hold({ method: "PUT", path: "/api/val/patches" });
  await page.studio.edit(homeVal, ["title"], "Hello world");
  await world.clock.advance(1_000); // the relay's debounce: the hook shows it
  const refreshesWhileHeld = page.refreshes;
  world.network.release();
  await world.settle();
  return { page, refreshesWhileHeld };
}
