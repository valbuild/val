import { Internal, initVal, type SourcePath } from "@valbuild/core";
import type { ValContentVersion, ValProposal } from "@valbuild/server";
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
 * The hosted layers: what a platform hands a build that its bundle does not
 * hold, and that only http mode reads. Catalogue ids S20, S21.
 *
 * Fed in as the platform feeds them: one `ValContentVersion` (what
 * `contentFromEnv` reads from `VAL_CONTENT`) and one `ValProposal` (what
 * `proposalFromEnv` reads from `VAL_PROPOSAL`, `VAL_BRANCH`, `VAL_OVERLAY`),
 * given to the app's API and to its page readers alike -- the same `http`
 * options object, as the bindings ask. Patches live on the mock content host
 * (`contentHost.ts`).
 *
 * Every surface reads both modules: `home`, which the content version
 * changed, and `about`, which it did not.
 */

const { s, c, config } = initVal({});
const HOME = "/content/home.val.ts";
const ABOUT = "/content/about.val.ts";
const homeVal = c.define(
  HOME,
  s.object({ title: s.string(), subtitle: s.string() }),
  { title: "Bundled home", subtitle: "Bundled subtitle" },
);
const aboutVal = c.define(ABOUT, s.object({ title: s.string() }), {
  title: "Bundled about",
});
const modules = [homeVal, aboutVal];

/** The site's content, published after the build that serves it was made. */
const contentVersion: ValContentVersion = {
  id: "version-2",
  job: null,
  commit: "scenariocommit1",
  modules: {
    [HOME]: { title: "Published home", subtitle: "Bundled subtitle" },
  },
  files: {},
};

/** A proposal that saved a change to `about`, and nothing else. */
const proposal: ValProposal = {
  name: "0123456789abcdef0123",
  branch: "val/p/0123456789abcdef0123",
  commit: "proposalsave1",
  modules: { [ABOUT]: { title: "Proposed about" } },
  files: {},
};

/**
 * Every reader of the two titles and the subtitle: the page's loaders for an
 * editor (draft mode) and for a visitor, and a page loaded with the overlay:
 * its hooks, and its overlay's Studio's fields. Answers the overlay's Studio,
 * which the scenario edits through: the world has no websocket, which is how
 * a second Studio in http mode hears of an edit (`/stat` is asked every
 * twenty minutes when there is one).
 */
async function readEverywhere(world: World) {
  const editor = world.page("/", { draftMode: true });
  editor.reads(
    "fetchVal home",
    async (val) => (await val.fetchVal(homeVal)).title,
  );
  editor.reads(
    "fetchVal subtitle",
    async (val) => (await val.fetchVal(homeVal)).subtitle,
  );
  editor.reads(
    "fetchVal about",
    async (val) => (await val.fetchVal(aboutVal)).title,
  );
  const visitor = world.page("/", { draftMode: false });
  visitor.reads(
    "visitor home",
    async (val) => (await val.fetchVal(homeVal)).title,
  );
  visitor.reads(
    "visitor about",
    async (val) => (await val.fetchVal(aboutVal)).title,
  );
  const page = await world.loadPage("/", {
    shows: [
      { surface: "useVal home", module: homeVal, field: ["title"] },
      { surface: "useVal subtitle", module: homeVal, field: ["subtitle"] },
      { surface: "useVal about", module: aboutVal, field: ["title"] },
    ],
  });
  page.studio.reads("studio home", homeVal, ["title"]);
  page.studio.reads("studio subtitle", homeVal, ["subtitle"]);
  page.studio.reads("studio about", aboutVal, ["title"]);
  return page.studio;
}

/**
 * The titles a Studio at `/val` holds: started like the overlay's, from the
 * page's modules, but with no base from a page (`/val` renders no site
 * layout, so `window.__VAL_BASE__` is not set there).
 */
async function valStudioTitles(world: World): Promise<Record<string, unknown>> {
  const studio = await world.studio("val");
  await world.settle();
  const read = async (path: SourcePath | undefined) => {
    if (path === undefined) throw new Error("no path");
    const res = await studio.system.sourceStore.get(path, null);
    return "data" in res ? res.data : `(${res.status})`;
  };
  return {
    home: await read(
      Internal.createValPathOfItem(Internal.getValPath(homeVal), "title"),
    ),
    about: await read(
      Internal.createValPathOfItem(Internal.getValPath(aboutVal), "title"),
    ),
  };
}

/** Each surface's last frame. */
function lastOfEach(world: World, surfaces: string[]): Record<string, unknown> {
  return Object.fromEntries(
    surfaces.map((surface) => [surface, world.frames.last(surface)]),
  );
}

const HOME_SURFACES = ["studio home", "fetchVal home", "useVal home"];
const SUBTITLE_SURFACES = [
  "studio subtitle",
  "fetchVal subtitle",
  "useVal subtitle",
];
const ABOUT_SURFACES = ["studio about", "fetchVal about", "useVal about"];
const all = (surfaces: string[], value: unknown) =>
  Object.fromEntries(surfaces.map((surface) => [surface, value]));

describe("on http", () => {
  let world: World | null = null;
  afterEach(async () => {
    await world?.dispose();
    world = null;
  });

  /**
   * S20 a content version newer than the bundle.
   *
   * Given a build whose bundle holds `Bundled home`, served with a content
   * version in which `home` is `Published home` and `about` is unchanged,
   * then every reader shows `Published home` and `Bundled about` -- the
   * version replaces the bundle for the module it changed and for nothing
   * else, for an editor and for a visitor;
   * and when an editor edits the subtitle of `home` and the title of `about`,
   * the edits apply over the VERSION: `home`'s title stays `Published home`
   * rather than going back to the bundle's.
   */
  test("S20 a content version newer than the bundle, with an unedited module", async () => {
    world = await createWorld({
      config,
      modules,
      server: "http",
      contentVersion,
    });
    const studio = await readEverywhere(world);
    await world.settle();
    await world.observe();
    expect(
      lastOfEach(world, [
        ...HOME_SURFACES,
        "visitor home",
        ...ABOUT_SURFACES,
        "visitor about",
      ]),
    ).toEqual({
      ...all([...HOME_SURFACES, "visitor home"], "Published home"),
      ...all([...ABOUT_SURFACES, "visitor about"], "Bundled about"),
    });
    expect(await valStudioTitles(world)).toEqual({
      home: "Published home",
      about: "Bundled about",
    });

    await studio.edit(homeVal, ["subtitle"], "Edited subtitle");
    await studio.edit(aboutVal, ["title"], "Edited about");
    await world.settle();
    await world.observe();
    // Different fields, so "converges" does not apply; the explicit
    // expectations below are the end state.
    world.frames.expectNeverGoesBack();
    expect(
      lastOfEach(world, [
        ...HOME_SURFACES,
        ...SUBTITLE_SURFACES,
        ...ABOUT_SURFACES,
        "visitor home",
        "visitor about",
      ]),
    ).toEqual({
      ...all(HOME_SURFACES, "Published home"),
      ...all(SUBTITLE_SURFACES, "Edited subtitle"),
      ...all(ABOUT_SURFACES, "Edited about"),
      // A visitor sees the site: the version, without the drafts.
      "visitor home": "Published home",
      "visitor about": "Bundled about",
    });
  });

  /**
   * S21 a proposal's address: its saves over the base content.
   *
   * Given the same build and content version, served at the address of a
   * proposal that saved `about` as `Proposed about`,
   * then every reader -- a visitor too, since a reviewer who is not editing
   * sees the proposal -- shows `Proposed about` and the version's
   * `Published home`: the proposal over the version over the bundle;
   * and an editor's edit to `home` at that address applies over the version,
   * and leaves the proposal's `about` where it is.
   */
  test("S21 a proposal's address: its saves over the base content", async () => {
    world = await createWorld({
      config,
      modules,
      server: "http",
      contentVersion,
      proposal,
    });
    const studio = await readEverywhere(world);
    await world.settle();
    await world.observe();
    expect(
      lastOfEach(world, [
        ...HOME_SURFACES,
        "visitor home",
        ...ABOUT_SURFACES,
        "visitor about",
      ]),
    ).toEqual({
      ...all([...HOME_SURFACES, "visitor home"], "Published home"),
      ...all([...ABOUT_SURFACES, "visitor about"], "Proposed about"),
    });
    expect(await valStudioTitles(world)).toEqual({
      home: "Published home",
      about: "Proposed about",
    });

    await studio.edit(homeVal, ["subtitle"], "Edited subtitle");
    await world.settle();
    await world.observe();
    // Different fields, so "converges" does not apply; the explicit
    // expectations below are the end state.
    world.frames.expectNeverGoesBack();
    expect(
      lastOfEach(world, [
        ...HOME_SURFACES,
        ...SUBTITLE_SURFACES,
        ...ABOUT_SURFACES,
        "visitor about",
      ]),
    ).toEqual({
      ...all(HOME_SURFACES, "Published home"),
      ...all(SUBTITLE_SURFACES, "Edited subtitle"),
      ...all([...ABOUT_SURFACES, "visitor about"], "Proposed about"),
    });
  });
});
