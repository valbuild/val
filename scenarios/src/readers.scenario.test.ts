import { Internal, initVal } from "@valbuild/core";
import { recordAddPatch } from "../../packages/ui/spa/components/recordPatches";
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
 * Readers: the page's loader, the page's hook and the Studio's field agreeing,
 * and the hooks' waits. Catalogue ids S22, S23, S24. (S25 is a unit test: see
 * the README.)
 */

const { s, c, config } = initVal({});
const homeVal = c.define(
  "/content/home.val.ts",
  s.object({ title: s.string() }),
  { title: "Hello" },
);
const title = { module: homeVal, field: ["title"] };
/** A router, for a page that exists only in a pending patch. */
const notesVal = c.define(
  "/src/routes/notes.$note.val.ts",
  s.router(Internal.tanstackRouter, s.object({ title: s.string() })),
  { "/notes/first": { title: "First" } },
);

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
   * then whenever two of them are at the same VERSION they show the same
   * value, and once the world is quiet all three show the same value at the
   * server's version.
   *
   * Every frame carries the version it was read at (phase 1): the loader's
   * from the server's answer, the hook's from what the server rendered and
   * then what the overlay relayed, the field's from what the Studio holds.
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
    // The loader catches up with an edit on the refresh the Studio's
    // `confirmed` sends once the server has the write (S05): no timer.
    await world.settle();
    await world.observe();

    expect([
      world.frames.last("hook"),
      world.frames.last("loader"),
      world.frames.last("field"),
    ]).toEqual(["Two", "Two", "Two"]);
    // Same version, same value, over every frame; and the end is one version.
    world.expectInvariants();
    const home = moduleFilePathOf(homeVal);
    const atServer = (await world.manifest()).modules[home];
    expect(atServer?.chain).not.toBe("");
    for (const surface of ["hook", "loader", "field"]) {
      expect(world.frames.lastVersion(surface, home)).toEqual(atServer);
    }
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

  /**
   * S24 `suspend` is three waits, and nothing else suspends.
   *
   * The waits are the overlay source's states (`overlaySource`, in
   * `@valbuild/react`): draft mode unknown, the Studio not done sending, and
   * no wait at all until the provider switches `suspend` on after hydrating
   * (`architecture/quirks.md`, "`suspend` is three waits"). A plain function
   * now, so the page's hooks are read here as they read: every step of the
   * load, each a frame or -- for a read that waits -- a suspension.
   */
  describe("S24", () => {
    const pendingEdit = async (w: World) => {
      const editor = await w.studio("editor");
      await editor.edit(homeVal, ["title"], "Draft title");
      await w.settle();
    };

    test.each([true, false])(
      "S24 without suspend, nothing suspends (draft prop: %s)",
      async (draftProp) => {
        world = await createWorld({ config, modules: [homeVal], server });
        await pendingEdit(world);
        const page = await world.loadPage("/", {
          shows: [{ surface: "hook", ...title }],
          draftProp,
        });
        await world.settle();

        expect(page.suspensions).toEqual([]);
        expect(world.frames.last("hook")).toBe("Draft title");
        world.expectInvariants();
      },
    );

    /*
     * With `suspend`, once the overlay is up the hooks wait -- for draft mode,
     * then for the Studio -- rather than show the published title, and then
     * show the draft. The server render and hydration still show it: the
     * gate is off on the render that decides (the third wait), which is the
     * next test.
     *
     * S24b, fixed in phase 4: the waits worked and ended too early. The
     * overlay's relay said `sources-synced` before it had sent the module
     * with the pending edit -- when the Studio's base aligns, its chain's
     * records have not been fetched yet, so `sendPendingSources` found no
     * patch to send and the page was told it had everything. The hooks
     * stopped waiting and rendered the published title, and the draft
     * followed on the next relay (`["sources-synced", "source-update", ...]`,
     * frames `Hello, Hello, Hello, Draft title`); for a route that only
     * exists in the patch, that published render was a `notFound()`. Now
     * `sources-synced` waits until the chain the Studio aligned to is in its
     * store (`onceInStep`) and every module of the catch-up has been handed
     * over.
     */
    test("S24b with suspend, the hooks wait for draft mode and the Studio, then show the draft", async () => {
      world = await createWorld({ config, modules: [homeVal], server });
      await pendingEdit(world);
      const page = await world.loadPage("/", {
        shows: [{ surface: "hook", ...title }],
        draftProp: false,
        suspend: true,
      });
      await world.settle();

      expect(page.suspensions.map((s) => s.step)).toEqual([
        "overlay mounted",
        "draft mode known",
      ]);
      // The module with the edit is handed over before the page is told it
      // has everything.
      const types = page.events.map((event) => event.type);
      expect(types.indexOf("source-update")).toBeGreaterThanOrEqual(0);
      expect(types.indexOf("source-update")).toBeLessThan(
        types.indexOf("sources-synced"),
      );
      const shown = world.frames.of("hook").map((frame) => frame.value);
      // The server render and hydration (no gate yet), then the draft: when
      // it is relayed, and again as `sources-synced` moves the provider's
      // state -- never the published title once the hooks have waited.
      expect(shown).toEqual(["Hello", "Hello", "Draft title", "Draft title"]);
      world.expectInvariants();
    });

    /*
     * A route that exists only in a pending patch. `useValRoute` returns
     * `null` for it on the server render and on hydration -- the render the
     * page turns into `notFound()`, which nothing later undoes -- because the
     * gate is not on yet for either (wait 3). Fixed by the `draft` prop
     * (below; on Next since phase 4, pinned by `ValNextProvider.draft.test.tsx`,
     * since this world drives a TanStack page); without it still open: the
     * server would have to know Val is enabled, which costs every visitor a
     * dynamic render. Kept failing, as the finding.
     */
    test.failing(
      "S24 with suspend, a route only in a pending patch is found on the render that decides, without the draft prop (fails today: wait 3)",
      async () => {
        world = await createWorld({ config, modules: [notesVal], server });
        const editor = await world.studio("editor");
        await editor.write(
          notesVal,
          recordAddPatch([], "/notes/new", { title: "New note" }),
        );
        await world.settle();
        await world.loadPage("/notes/new", {
          shows: [
            {
              surface: "route",
              module: notesVal,
              field: ["title"],
              via: { useValRoute: { note: "new" } },
            },
          ],
          draftProp: false,
          suspend: true,
        });
        await world.settle();

        const shown = world.frames.of("route").map((frame) => frame.value);
        expect(shown.length).toBeGreaterThan(0);
        // Not found is no value: on the server render and on hydration,
        // today. (`toStrictEqual`: `toEqual` would not see an `undefined`.)
        expect(shown).toStrictEqual(shown.map(() => "New note"));
      },
    );

    test("S24 with suspend and the draft prop, the route is found on every render", async () => {
      world = await createWorld({ config, modules: [notesVal], server });
      const editor = await world.studio("editor");
      await editor.write(
        notesVal,
        recordAddPatch([], "/notes/new", { title: "New note" }),
      );
      await world.settle();
      const page = await world.loadPage("/notes/new", {
        shows: [
          {
            surface: "route",
            module: notesVal,
            field: ["title"],
            via: { useValRoute: { note: "new" } },
          },
        ],
        suspend: true,
      });
      await world.settle();

      const shown = world.frames.of("route").map((frame) => frame.value);
      expect(shown.length).toBeGreaterThan(0);
      expect(shown).toStrictEqual(shown.map(() => "New note"));
      expect(page.suspensions).toEqual([]);
    });
  });
});
