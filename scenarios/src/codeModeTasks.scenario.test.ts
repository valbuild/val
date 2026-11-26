import { initVal } from "@valbuild/core";
import { createWorld, type World } from "./world/createWorld";
import type { CodeToolAnswer } from "../../packages/ui/spa/proposals/proposalCode";
import {
  reportCodeMode,
  resetCodeMode,
} from "../../packages/ui/spa/proposals/codeMode";
import { resetStagedCode } from "../../packages/ui/spa/proposals/stagedCode";
import {
  BUTTON_FILE,
  darkHero,
  HERO_FILE,
  indexRoute,
  ROUTE_FILE,
  siteCode,
} from "../../e2e/proposal/codeModeSite";

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
 * Simple code-mode tasks, start to finish, as the assistant does them: find
 * the code (`search_code`), read it (`read_file`), change it (`edit_file`,
 * `write_files`), check it (`lint`), and Build. The model is not here: each
 * task is the sequence of tool calls a model makes for it, with the
 * arguments it would send, and what is asserted is what the TOOLS answered
 * and what the Studio, the server and a page then do -- never what a model
 * would make of it.
 *
 * The tools run as `useAI` runs them (`ProposalAt.assistant`: one
 * `createCodeClients` for the chat, its snapshot of the project anchored on
 * the Studio's `seq`), against Val's real server at a proposal's address and
 * the content host. The site's code is `e2e/proposal/codeModeSite.ts`, which
 * the browser tests (`e2e/proposal/codeModeTasks.spec.ts`) do the same tasks
 * on, with the quick preview and the page the browser adds.
 *
 * Every task ends with a Build landing, and holds that the Studio did not
 * reload its page for it (`codeModeBuild.scenario.test.ts` has the paths one
 * by one) -- except T4, the one where nothing else is left: a schema change
 * the tab could not evaluate, built into code the Studio cannot import. A
 * reload is the last resort there, and T4 holds that it is one: once, and
 * only after the build's code was tried.
 */

const { s, c, config } = initVal({});
const HOME = "/content/home.val.ts";
const HOME_FILE = "content/home.val.ts";

const before = c.define(
  HOME,
  s.object({ title: s.string(), intro: s.string() }),
  {
    title: "Dette er så gøy",
    intro: "Vi lager nettsider som er enkle å endre.",
  },
);
const withEyebrow = c.define(
  HOME,
  s.object({ eyebrow: s.string(), title: s.string(), intro: s.string() }),
  {
    eyebrow: "Nyhet",
    title: "Dette er så gøy",
    intro: "Vi lager nettsider som er enkle å endre.",
  },
);
const homeText = `import { c, s } from "../val.config";

export default c.define(
  "${HOME}",
  s.object({ title: s.string(), intro: s.string() }),
  {
    title: "Dette er så gøy",
    intro: "Vi lager nettsider som er enkle å endre.",
  },
);
`;

/** The edits that add the eyebrow to the schema, and to its content. */
const eyebrowSchema = {
  old_string: `  s.object({ title: s.string(), intro: s.string() }),`,
  new_string: `  s.object({ eyebrow: s.string(), title: s.string(), intro: s.string() }),`,
};
const eyebrowContent = {
  old_string: `  {\n    title: "Dette er så gøy",`,
  new_string: `  {\n    eyebrow: "Nyhet",\n    title: "Dette er så gøy",`,
};
/** And the route passing it to the hero. */
const eyebrowProp = {
  old_string: `        title="Dette er så gøy"`,
  new_string: `        eyebrow="Nyhet"\n        title="Dette er så gøy"`,
};

/** A tool's answer, narrowed: it succeeded, and this is what it said. */
function ok(answer: CodeToolAnswer): Record<string, unknown> {
  expect(answer.isError ? JSON.stringify(answer.result) : "ok").toBe("ok");
  return Object(answer.result);
}

describe("code-mode tasks, start to finish", () => {
  let world: World | null = null;
  afterEach(async () => {
    await world?.dispose();
    world = null;
    resetCodeMode();
    resetStagedCode();
  });

  /** The proposal `</>` made, in code mode, with the site's code in it. */
  const open = async () => {
    world = await createWorld({
      config,
      modules: [before],
      server: "http",
      sourceText: {
        [HOME]: homeText,
        ...Object.fromEntries(
          Object.entries(siteCode).map(([path, text]) => [`/${path}`, text]),
        ),
      },
      proposal: { open: "Code mode" },
    });
    const proposal = world.proposal;
    if (proposal === null) throw new Error("not at a proposal's address");
    if (world.server.mode !== "http") throw new Error("not on http");
    // What the site's last publish left the platform holding: the live
    // build's files, which the code tools read by version.
    const published = await fetch(
      `${world.server.contentUrl}/__test__/project-source`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          files: { [HOME_FILE]: homeText, ...siteCode },
        }),
      },
    );
    if (!published.ok) throw new Error(`project-source: ${published.status}`);
    const editor = await world.studio("editor");
    const turned = await proposal.codeMode(true);
    // What `useProposalsBar` does with the proposal it reads.
    reportCodeMode({
      name: proposal.name,
      displayName: turned.displayName,
      on: true,
    });
    await world.settle();
    return { world, proposal, editor, assistant: proposal.assistant(editor) };
  };

  /** The build lands at the address, and the Studio has time to react. */
  const buildLands = async (
    world: World,
    options?: Parameters<NonNullable<World["proposal"]>["redeploy"]>[0],
  ) => {
    await world.proposal?.redeploy(options);
    await world.clock.advance(21_000);
    await world.settle();
    await world.clock.advance(4_000);
    await world.settle();
  };

  test("T1 make the hero dark: search, read, edit, check, build", async () => {
    const { world, editor, assistant } = await open();
    editor.reads("title", before, ["title"]);

    // Where is the hero's background?
    const found = ok(
      await assistant.run("search_code", { query: "bg-white", prefix: "src/" }),
    );
    expect(found.matches).toEqual([
      {
        path: HERO_FILE,
        line: 11,
        text: `<section className="bg-white text-black py-24">`,
      },
    ]);
    // The lines around it, exactly as edit_file needs them.
    const read = ok(
      await assistant.run("read_file", {
        path: HERO_FILE,
        offset: 10,
        limit: 3,
      }),
    );
    expect(read.text).toContain(darkHero.old_string);
    // The change.
    ok(
      await assistant.run("edit_file", {
        path: HERO_FILE,
        ...darkHero,
        message: "A darker hero",
      }),
    );
    await world.settle();
    // Read back as the proposal's, and nothing else of the site's moved.
    const after = ok(await assistant.run("read_file", { path: HERO_FILE }));
    expect(after.text).toContain(darkHero.new_string);
    expect(after.staged).toBe(true);
    const gone = ok(await assistant.run("search_code", { query: "bg-white" }));
    expect(gone.matches).toEqual([]);
    expect(
      ok(await assistant.run("read_file", { path: BUTTON_FILE })).staged,
    ).toBe(false);
    ok(await assistant.run("lint", {}));

    await buildLands(world);
    await world.observe();

    expect(editor.reloads()).toBe(0);
    expect(world.frames.last("title")).toBe("Dette er så gøy");
    expect(editor.errors()).toEqual([]);
    world.expectInvariants();
  });

  test("T2 show an eyebrow from the content, where the tab can evaluate it: edit the module and the route, fill it in, build", async () => {
    const { world, editor, assistant } = await open();

    const found = ok(
      await assistant.run("search_code", {
        query: "c.define",
        prefix: "content/",
      }),
    );
    expect(found.matches).toEqual([
      expect.objectContaining({ path: HOME_FILE }),
    ]);
    expect(ok(await assistant.run("read_file", { path: HOME_FILE })).text).toBe(
      homeText,
    );
    ok(
      await assistant.run("edit_file", {
        path: HOME_FILE,
        ...eyebrowSchema,
        message: "An eyebrow",
      }),
    );
    // The second edit of the module, which the tab evaluates.
    const staged = ok(
      await assistant.run(
        "edit_file",
        { path: HOME_FILE, ...eyebrowContent, message: "An eyebrow" },
        { evaluateIn: { modules: [withEyebrow] } },
      ),
    );
    expect(staged.valModules).toMatchObject({
      status: "evaluated",
      schemaChanged: [HOME],
    });
    ok(
      await assistant.run("edit_file", {
        path: ROUTE_FILE,
        ...eyebrowProp,
        message: "Show it",
      }),
    );
    expect(
      ok(await assistant.run("read_file", { path: ROUTE_FILE })).text,
    ).toBe(indexRoute.replace(eyebrowProp.old_string, eyebrowProp.new_string));
    await world.settle();

    // The editor fills it in before anything is built.
    editor.reads("eyebrow", withEyebrow, ["eyebrow"]);
    await editor.edit(withEyebrow, ["eyebrow"], "Nytt i år");
    await world.settle();

    await buildLands(world);
    await world.observe();

    expect(editor.reloads()).toBe(0);
    expect(world.frames.last("eyebrow")).toBe("Nytt i år");
    expect(editor.errors()).toEqual([]);
    world.expectInvariants();
  });

  test("T3 the same task where the tab cannot evaluate it (a Studio that builds on Val Build): the build's code is taken in place", async () => {
    const { world, editor, assistant } = await open();

    ok(
      await assistant.run("edit_file", {
        path: HOME_FILE,
        ...eyebrowSchema,
        message: "An eyebrow",
      }),
    );
    ok(
      await assistant.run("edit_file", {
        path: HOME_FILE,
        ...eyebrowContent,
        message: "An eyebrow",
      }),
    );
    expect(assistant.evaluations()).toBe(0);
    await world.settle();

    await buildLands(world, { modules: [withEyebrow] });
    editor.reads("eyebrow", withEyebrow, ["eyebrow"]);
    await world.observe();

    expect(editor.reloads()).toBe(0);
    expect(editor.work.count("code:import-build")).toBeGreaterThanOrEqual(1);
    expect(world.frames.last("eyebrow")).toBe("Nyhet");
    expect(editor.errors()).toEqual([]);
    world.expectInvariants();
  });

  /**
   * T3, with a build whose code is not on the site (no `val-modules` entry):
   * the Studio has the old schema, cannot evaluate the new one and cannot
   * import the build's. Reloading the page is the last resort, and allowed:
   * once, after the build landed and its code was tried, and never before.
   */
  test("T4 the same task, and a build whose code the Studio cannot import: a reload, as the last resort only", async () => {
    const { world, editor, assistant } = await open();

    ok(
      await assistant.run("edit_file", {
        path: HOME_FILE,
        ...eyebrowSchema,
        message: "An eyebrow",
      }),
    );
    ok(
      await assistant.run("edit_file", {
        path: HOME_FILE,
        ...eyebrowContent,
        message: "An eyebrow",
      }),
    );
    await world.settle();
    // Nothing reloads for the writes: only a build can move the schema.
    await world.clock.advance(25_000);
    await world.settle();
    expect(editor.reloads()).toBe(0);

    await buildLands(world, { modules: [withEyebrow], registry: "missing" });

    // The build's code was tried first...
    expect(editor.work.count("code:import-build")).toBe(1);
    // ...and only then the page reloaded, once.
    expect(editor.reloads()).toBe(1);
    await world.clock.advance(30_000);
    await world.settle();
    expect(editor.reloads()).toBe(1);
    expect(editor.errors()).toEqual([]);
    editor.expectReloads(1);
  });

  test("T5 add a section: a new component, the route rendering it, lint, build", async () => {
    const { world, editor, assistant } = await open();
    editor.reads("title", before, ["title"]);
    const SECTION = "src/components/sections/Contact.tsx";

    ok(
      await assistant.run("write_files", {
        files: {
          [SECTION]: `export default function Contact() {\n  return <section className="py-16"><h2>Ta kontakt</h2></section>;\n}\n`,
        },
        message: "A contact section",
      }),
    );
    ok(
      await assistant.run("edit_file", {
        path: ROUTE_FILE,
        old_string: `import HeroSection from "../components/sections/HeroSection";`,
        new_string: `import HeroSection from "../components/sections/HeroSection";\nimport Contact from "../components/sections/Contact";`,
      }),
    );
    ok(
      await assistant.run("edit_file", {
        path: ROUTE_FILE,
        old_string: `      />\n    </main>`,
        new_string: `      />\n      <Contact />\n    </main>`,
      }),
    );
    await world.settle();
    const listed = ok(
      await assistant.run("list_files", { prefix: "src/components/sections/" }),
    );
    expect(JSON.stringify(listed)).toContain(SECTION);
    expect(
      ok(await assistant.run("search_code", { query: "<Contact />" })).matches,
    ).toEqual([expect.objectContaining({ path: ROUTE_FILE })]);
    ok(await assistant.run("lint", {}));

    await buildLands(world);
    await world.observe();

    expect(editor.reloads()).toBe(0);
    expect(world.frames.last("title")).toBe("Dette er så gøy");
    expect(editor.errors()).toEqual([]);
    world.expectInvariants();
  });
});
