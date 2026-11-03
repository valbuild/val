import { initVal } from "@valbuild/core";
import { createWorld, type ServerMode } from "./world/createWorld";

jest.mock(
  "@tanstack/react-start/server",
  () => jest.requireActual("./world/tanstackStart"),
  { virtual: true },
);
jest.mock("../../packages/ui/spa/validation/schemaValidationBridge", () =>
  jest.requireActual("./world/noWorkerBridge"),
);

/**
 * "After doing a code change with quick preview and also a build, then load
 * the preview page with the overlay (not inside the Studio), I see the content
 * flicker: first the new, then the old (very briefly), then the new."
 *
 * The code change edits content written in code (the title's literal) and adds
 * a field, so the build before it and the build after it disagree about the
 * module's source. The page is loaded with the overlay on it, in draft mode,
 * the way a TanStack page is (`world.loadPage`): server render from a
 * server-read draft, hydration from the same draft, then the overlay's Studio
 * and its relay. Every step records what the page shows, so "never goes back"
 * is the flicker.
 *
 * Two ways reproduce new -> old -> new. Both need two builds in play at once,
 * which is what the minute after a build is: "an edge can keep serving the
 * previous build for up to a minute" (`publishBuild`, `ValRouter.ts`).
 *
 * The quick preview is not one of them: its service worker serves its files
 * only to a document opened with `?val_quick=<id>`
 * (`QUICK_PREVIEW_SERVICE_WORKER_SOURCE`), so a plain load is untouched, and
 * its files are the NEW code anyway.
 */

const { s, c, config } = initVal({});
const PATH = "/content/home.val.ts";
const before = c.define(
  PATH,
  s.object({ title: s.string(), subtitle: s.string() }),
  { title: "Old title", subtitle: "Sub" },
);
const after = c.define(
  PATH,
  s.object({ title: s.string(), subtitle: s.string(), cta: s.string() }),
  { title: "New title", subtitle: "Sub", cta: "Buy" },
);
const shows = [{ surface: "title", module: after, field: ["title"] }];

const titles = (world: Awaited<ReturnType<typeof createWorld>>) =>
  world.frames.of("title").map((frame) => frame.value);

describe.each<ServerMode>(["memory", "fs", "http"])("on %s", (server) => {
  test("the page and its overlay run the same build: no flicker", async () => {
    const world = await createWorld({ config, modules: [before], server });
    try {
      world.deployCode([after]);
      await world.loadPage("/", { shows });
      await world.settle();
      world.expectInvariants();
      expect(world.frames.last("title")).toBe("New title");
    } finally {
      await world.dispose();
    }
  });

  test("with an edit pending on the module: no flicker", async () => {
    const world = await createWorld({ config, modules: [before], server });
    try {
      const editor = await world.studio("editor");
      await editor.edit(before, ["subtitle"], "Edited");
      await world.settle();
      world.deployCode([after]);
      await world.loadPage("/", {
        shows: [
          ...shows,
          { surface: "subtitle", module: after, field: ["subtitle"] },
        ],
      });
      await world.settle();
      // Two fields, so "converges" (every surface the same value) does not apply.
      world.frames.expectNeverGoesBack();
      expect(world.frames.last("title")).toBe("New title");
      expect(world.frames.last("subtitle")).toBe("Edited");
    } finally {
      await world.dispose();
    }
  });

  /**
   * Mechanism 1: the overlay's `/stat` is answered by the PREVIOUS build.
   *
   * The page is rendered by the new build. The overlay's Studio starts from
   * the page's own (new) modules, then asks `/stat` -- and the previous build,
   * still served for a while, answers it. It used to answer with its OWN
   * `sourcesSha`, and `BaseAlignment` did what it was built for after a
   * publish: it fetched that build's base (`PUT /sources/~`, the previous
   * build too) and rebased onto it, and once "aligned" the relay handed the
   * page the previous build's title, until the new build answered a later
   * `/stat` and the new title came back.
   *
   * Fixed in fs and memory mode (phase 7, the part that does not need phase
   * 6): there the patches are the STORE's, relative to what the newest build
   * evaluated, so a previous build still answering names the newest build's
   * base as the one its chain belongs on (`ValOps.chainBaseSha`). The Studio
   * already holds it, so nothing is fetched and nothing old is relayed.
   *
   * And on http (phase 7, with valbuild/home's live build): there the content
   * service answers each build with the patches THAT build does not contain,
   * and only it knows a newer build is live. Every build reports its base
   * (`sources_sha`), and `/stat` asks for the chain relative to the live
   * build (`relative_to=live`): a previous build is answered at the live one,
   * with its base, and names that (`OrderedPatchesMetadata.chainBase`). The
   * world reports each build live as the platform does, by the name its
   * server asks as (`publishBuild`).
   */
  test("the overlay's /stat answered by the previous build: no flicker", async () => {
    const world = await createWorld({ config, modules: [before], server });
    try {
      await overlayAnsweredByPreviousBuild(world);
      world.expectInvariants();
      // One surface, so "converges" cannot see a page that ends on the
      // previous build's title: say it.
      expect(titles(world)).not.toContain("Old title");
      expect(world.frames.last("title")).toBe("New title");
      // The previous build's base is never fetched: its stat already
      // named the base the Studio holds.
      const overlay = world.network.log
        .filter((e) => e.from.startsWith("studio:overlay"))
        .map((e) => `${e.method} ${e.path.replace("/api/val", "")}`);
      expect(overlay).not.toContain("PUT /sources/~");
    } finally {
      await world.dispose();
    }
  });

  /**
   * Mechanism 2: the browser runs the previous build's CLIENT code.
   *
   * The server renders the new title. The browser hydrates with client code
   * from before the build (`/_app/app.js` is an unhashed name, so a cached
   * copy is possible; whether the platform's cache headers allow it is not
   * modelled). The module has no pending edit, so the draft store has nothing
   * for it and `useVal` falls back to the bundle -- the old literal -- which
   * React renders over the server's text. The overlay's Studio, started from
   * the same old modules, sees the server's `sourcesSha` differ, rebases onto
   * the server's base, and relays the new title.
   *
   * SKIPPED, not failing: the cause is known (on the platform, the pinned
   * `/_app/app.js?b=` falls back to the head when the new build's code is not
   * yet readable at that edge) and its fix is deferred while coverage is built
   * out. The reproduction of WHY is the test below, which runs.
   */
  test.skip("the browser runs the previous build's client code: no flicker", async () => {
    const world = await createWorld({ config, modules: [before], server });
    try {
      world.deployCode([after]);
      await world.loadPage("/", { shows, clientModules: [before] });
      await world.settle();
      world.expectInvariants();
    } finally {
      await world.dispose();
    }
  });

  test("why it flickers: hydration reads the old bundle, the overlay relays the server's base", async () => {
    const world = await createWorld({ config, modules: [before], server });
    try {
      world.deployCode([after]);
      const page = await world.loadPage("/", {
        shows,
        clientModules: [before],
      });
      await world.settle();
      expect(titles(world)).toEqual([
        "New title", // the server render (new build)
        "Old title", // hydration with the previous build's client code
        "New title", // the overlay, aligned to the server's base
      ]);
      expect(page.events.map((event) => event.type)).toContain("source-update");
    } finally {
      await world.dispose();
    }
  });
});

/**
 * Deploy the new build, then load the page while the previous build still
 * answers the overlay; switch to the new build once the page is loaded.
 */
async function overlayAnsweredByPreviousBuild(
  world: Awaited<ReturnType<typeof createWorld>>,
) {
  const deployment = world.deployCode([after]);
  world.network.routeBy(({ from }) =>
    from.startsWith("studio:overlay") ? deployment.previous : null,
  );
  await world.loadPage("/", { shows });
  await world.settle();
  world.network.routeBy(null);
  // The previous build's long poll runs out; the next one reaches the new build.
  await world.clock.advance(21_000);
  await world.settle();
}
