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
 * Build, after a coding session in code mode: the Studio takes the build in
 * place and NEVER reloads its page.
 *
 * Reported: "clicking the Build button after a coding session refreshes the
 * whole page", at a proposal made by `</>` on the site (the site-code
 * proposal: made from the site's head, never built, so its address serves
 * the SITE's build until the first Build). A reload in code mode loses the
 * assistant's turn on screen, the canvas and where the editor was.
 *
 * What reloads a Studio's page is `BuildCode` (`stores/buildCode.ts`): a
 * manifest naming a schema this Studio does not run, which it cannot take in
 * place -- no registry on the manifest, a registry that does not load,
 * another Val. A build the platform made names its registry, so after a
 * proposal's Build every path here is expected to swap the code in, or to
 * have nothing to swap.
 *
 * The paths are the ways a coding session can leave the Studio relative to
 * the build that lands:
 *
 * - B1 only components changed: no schema moves.
 * - B2 a `.val.ts` changed and the tab evaluated it: the Studio is AHEAD.
 * - B3 a `.val.ts` changed and the tab did NOT evaluate it (another tab's
 *   assistant, or an evaluation that did not run): the build's code has to
 *   be imported.
 * - B4 two rounds of write, Build: the second build lands on a Studio that
 *   took the first one in.
 * - B5 an edit typed while the build is under way.
 * - B6 / B7 the build names a registry that is not on the site (no
 *   `val-modules-<build>.js`: `valModulesEntry` in `@valbuild/tanstack-build`
 *   emits none for Val modules it cannot bundle for the browser, and
 *   `architecture/quirks.md` names that 404 as THE reason a hosted Studio
 *   reloads after a deploy). B6, a `.val.ts` the tab did not evaluate, is
 *   what a hosted Studio is left with after every schema change: the tab
 *   evaluates staged code only where it can bundle (`canBuildHere`,
 *   `studioStagedCodeDeps`), and a Studio that builds on Val Build mostly
 *   cannot. That is the one path here that reloads today.
 *
 * Every action is the product's, as in `codeMode.scenario.test.ts`: the
 * writes are the assistant's `write_files` (`runCodeTool`), the build is
 * served as the platform serves it (`redeploy`), and the Studio's reaction
 * is its own `/stat` poll, manifest and `BuildCode`. A reload is counted,
 * not done (`createWorld`'s `reloadStudio`).
 */

const { s, c, config } = initVal({});
const HOME = "/content/home.val.ts";
const HOME_FILE = "content/home.val.ts";
const HERO_FILE = "src/components/sections/HeroSection.tsx";

const before = c.define(HOME, s.object({ title: s.string() }), {
  title: "Dette er så gøy",
});
const after = c.define(
  HOME,
  s.object({ title: s.string(), eyebrow: s.string() }),
  { title: "Dette er så gøy", eyebrow: "Nytt" },
);

const beforeText = `import { c, s } from "../val.config";

export default c.define(
  "${HOME}",
  s.object({ title: s.string() }),
  { title: "Dette er så gøy" },
);
`;
const afterText = `import { c, s } from "../val.config";

export default c.define(
  "${HOME}",
  s.object({ title: s.string(), eyebrow: s.string() }),
  { title: "Dette er så gøy", eyebrow: "Nytt" },
);
`;
const heroText = (heading: string) =>
  `export default function HeroSection() {\n  return <section className="bg-black"><h1>${heading}</h1></section>;\n}\n`;

describe("Build in code mode, at a proposal the site's </> made", () => {
  let world: World | null = null;
  afterEach(async () => {
    await world?.dispose();
    world = null;
  });

  const open = async () => {
    world = await createWorld({
      config,
      modules: [before],
      server: "http",
      sourceText: { [HOME]: beforeText },
      proposal: { open: "Code mode" },
    });
    const proposal = world.proposal;
    if (proposal === null) throw new Error("not at a proposal's address");
    const editor = await world.studio("editor");
    // Arriving from `</>`: code mode on (`CODE_MODE_PARAM`).
    await proposal.codeMode(true);
    await world.settle();
    return { world, proposal, editor };
  };

  /**
   * The platform serves the build at the address, and the Studio has time
   * to notice it -- its `/stat` poll parked on the old build runs out -- and
   * past the grace after which a Studio that could not take it in place
   * would reload (`STUDIO_RELOAD_GRACE_MS`).
   */
  const buildLands = async (
    world: World,
    options?: { registry?: "missing" },
  ) => {
    await world.proposal?.redeploy(options);
    await world.clock.advance(21_000);
    await world.settle();
    await world.clock.advance(4_000);
    await world.settle();
  };

  test("B1 only a component changed: Build does not reload the Studio", async () => {
    const { world, proposal, editor } = await open();
    editor.reads("title", before, ["title"]);
    const staged = await proposal.stage(
      { [HERO_FILE]: heroText("Dette er så gøy") },
      "A darker hero",
    );
    expect(staged.isError).toBe(false);
    await world.settle();

    await buildLands(world);
    await world.observe();

    expect(editor.reloads()).toBe(0);
    expect(world.frames.last("title")).toBe("Dette er så gøy");
    expect(editor.errors()).toEqual([]);
    world.expectInvariants();
  });

  test("B2 a .val.ts the tab evaluated: Build does not reload the Studio", async () => {
    const { world, proposal, editor } = await open();
    const staged = await proposal.stage({ [HOME_FILE]: afterText }, "Eyebrow", {
      studio: editor,
      modules: [after],
    });
    expect(staged.isError).toBe(false);
    await world.settle();
    editor.reads("eyebrow", after, ["eyebrow"]);

    await buildLands(world);
    await world.observe();

    expect(editor.reloads()).toBe(0);
    expect(world.frames.last("eyebrow")).toBe("Nytt");
    expect(editor.errors()).toEqual([]);
    world.expectInvariants();
  });

  test("B3 a .val.ts the tab did not evaluate: the build's code is taken in place, no reload", async () => {
    const { world, proposal, editor } = await open();
    // Staged with no evaluation in this tab, but built from `after`: what
    // the platform's build of the staged files evaluates to.
    const staged = await proposal.stage({ [HOME_FILE]: afterText }, "Eyebrow", {
      studio: (await world.studio("other tab")) ?? editor,
      modules: [after],
    });
    expect(staged.isError).toBe(false);
    await world.settle();

    await buildLands(world);
    editor.reads("eyebrow", after, ["eyebrow"]);
    await world.observe();

    expect(editor.reloads()).toBe(0);
    expect(editor.work.count("code:import-build")).toBeGreaterThanOrEqual(1);
    expect(world.frames.last("eyebrow")).toBe("Nytt");
    expect(editor.errors()).toEqual([]);
    world.expectInvariants();
  });

  test("B4 write, Build, write, Build: neither Build reloads the Studio", async () => {
    const { world, proposal, editor } = await open();
    editor.reads("title", before, ["title"]);
    expect(
      (await proposal.stage({ [HERO_FILE]: heroText("One") }, "One")).isError,
    ).toBe(false);
    await world.settle();
    await buildLands(world);
    expect(
      (
        await proposal.stage({ [HOME_FILE]: afterText }, "Eyebrow", {
          studio: editor,
          modules: [after],
        })
      ).isError,
    ).toBe(false);
    await world.settle();
    await buildLands(world);
    await world.observe();

    expect(editor.reloads()).toBe(0);
    expect(editor.errors()).toEqual([]);
    world.expectInvariants();
  });

  test("B5 an edit typed while the build is under way is kept, and nothing reloads", async () => {
    const { world, proposal, editor } = await open();
    editor.reads("title", before, ["title"]);
    expect(
      (await proposal.stage({ [HERO_FILE]: heroText("One") }, "One")).isError,
    ).toBe(false);
    await world.settle();
    await editor.edit(before, ["title"], "Dette er enda gøyere");
    await buildLands(world);
    await world.observe();

    expect(editor.reloads()).toBe(0);
    expect(world.frames.last("title")).toBe("Dette er enda gøyere");
    expect(editor.errors()).toEqual([]);
    world.expectInvariants();
  });

  /**
   * The schema moved under a Studio that did not evaluate it, and the
   * build's code cannot be imported: today `BuildCode` reloads the page
   * three seconds after the build lands (`scheduleReload`). In code mode it
   * is the Studio's own Build that landed, in the middle of the session the
   * person is in. What the Studio does instead of reloading is the fix's to
   * decide; that it does not reload by itself is what this holds.
   */
  test("B6 a .val.ts the tab did not evaluate, and a build whose code is not on the site: no reload", async () => {
    const { world, proposal, editor } = await open();
    const staged = await proposal.stage({ [HOME_FILE]: afterText }, "Eyebrow", {
      studio: (await world.studio("other tab")) ?? editor,
      modules: [after],
    });
    expect(staged.isError).toBe(false);
    await world.settle();

    await buildLands(world, { registry: "missing" });

    expect(editor.work.count("code:import-build")).toBeGreaterThanOrEqual(1);
    expect(editor.reloads()).toBe(0);
    expect(editor.errors()).toEqual([]);
  });

  test("B7 only a component changed, and a build whose code is not on the site: no reload", async () => {
    const { world, proposal, editor } = await open();
    editor.reads("title", before, ["title"]);
    expect(
      (await proposal.stage({ [HERO_FILE]: heroText("One") }, "One")).isError,
    ).toBe(false);
    await world.settle();

    await buildLands(world, { registry: "missing" });
    await world.observe();

    expect(editor.reloads()).toBe(0);
    expect(world.frames.last("title")).toBe("Dette er så gøy");
    expect(editor.errors()).toEqual([]);
    world.expectInvariants();
  });
});
