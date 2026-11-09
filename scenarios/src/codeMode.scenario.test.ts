import { initVal } from "@valbuild/core";
import { createWorld, type World } from "./world/createWorld";
import { publishCommitRefusalOf } from "../../packages/ui/spa/proposals/commitProposal";

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
 * Code mode (`docs/plans/one-content-model.md`, "Code mode"), in the http
 * world at a proposal's address: content and code are never in two places
 * when code changes.
 *
 * Every action is the product's: code mode is turned on and off with the
 * call the `</>` and the assistant's card make (`ProposalsClient.setCodeMode`),
 * code is written through the assistant's `write_files` (`runCodeTool`, with
 * the code-mode check the Studio's assistant gives it), and Commit is the
 * Studio's `commitProposal`. The saves before a code write are Val's
 * server's (`beforeProposalCodeWrite`), not the world's. Build on their push
 * is the Studio's `buildOnTheirPush`, a refused Publish is read with its
 * `publishCommitRefusalOf`, and the build Publish then waits for is its
 * `buildProposal` (with the bundler at the world's edge).
 */

const { s, c, config } = initVal({});
const HOME = "/content/home.val.ts";
const HOME_FILE = "content/home.val.ts";
const HERO_FILE = "src/components/Hero.tsx";

const before = c.define(HOME, s.object({ title: s.string() }), {
  title: "Hello",
});
// The assistant adds a button to the page's schema, with content for it.
const after = c.define(
  HOME,
  s.object({ title: s.string(), button: s.object({ label: s.string() }) }),
  { title: "Hello", button: { label: "Buy" } },
);

/** The same module, evaluated again: a new instance, the same content. */
const afterAgain = c.define(
  HOME,
  s.object({ title: s.string(), button: s.object({ label: s.string() }) }),
  { title: "Hello", button: { label: "Buy" } },
);

const beforeText = (title: string) => `import { c, s } from "../val.config";

export default c.define(
  "${HOME}",
  s.object({ title: s.string() }),
  { title: ${JSON.stringify(title)} },
);
`;
const afterText = (title: string, label: string) =>
  `import { c, s } from "../val.config";

export default c.define(
  "${HOME}",
  s.object({ title: s.string(), button: s.object({ label: s.string() }) }),
  { title: ${JSON.stringify(title)}, button: { label: ${JSON.stringify(label)} } },
);
`;
const PROMO = "/content/promo.val.ts";
const PROMO_FILE = "content/promo.val.ts";
// A module the proposal adds, which the build before it does not have.
const promo = c.define(PROMO, s.object({ headline: s.string() }), {
  headline: "Spring sale",
});
const promoText = (headline: string) => `import { c, s } from "../val.config";

export default c.define(
  "${PROMO}",
  s.object({ headline: s.string() }),
  { headline: ${JSON.stringify(headline)} },
);
`;
const heroText = `export function Hero() {\n  return <h1>Hero</h1>;\n}\n`;
const FOOTER_FILE = "src/components/Footer.tsx";
const footerText = `export function Footer() {\n  return <footer>Footer</footer>;\n}\n`;

describe("code mode, in a proposal on http", () => {
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
      sourceText: { [HOME]: beforeText("Hello") },
      proposal: { open: "Spring campaign" },
    });
    const proposal = world.proposal;
    if (proposal === null) throw new Error("not at a proposal's address");
    const editor = await world.studio("editor");
    return { world, proposal, editor };
  };

  test("C1 entering code mode saves every pending change", async () => {
    const { world, proposal, editor } = await open();
    editor.reads("studio", before, ["title"]);
    await editor.edit(before, ["title"], "Spring");
    await world.settle();
    expect((await proposal.client.files(proposal.name)).files).toEqual({});

    const turned = await proposal.codeMode(true);
    expect(turned.codeMode?.on).toBe(true);
    await world.settle();
    await world.observe();

    const files = await proposal.client.files(proposal.name);
    expect(files.files[HOME_FILE]).toContain('"Spring"');
    expect((await proposal.client.get(proposal.name)).changes).toBe(0);
    expect(world.frames.last("studio")).toBe("Spring");
    world.frames.expectNeverGoesBack();
    expect(editor.errors()).toEqual([]);
  });

  test("C2 a code write saves the content changes made since, first", async () => {
    const { world, proposal, editor } = await open();
    await proposal.codeMode(true);
    await editor.edit(before, ["title"], "Spring");
    await world.settle();

    const staged = await proposal.stage({ [HERO_FILE]: heroText }, "A hero");
    expect(staged.isError).toBe(false);

    const files = await proposal.client.files(proposal.name);
    // The edit was saved before the code was written: the .val.ts the
    // assistant reads next is the current content.
    expect(files.files[HOME_FILE]).toContain('"Spring"');
    expect(files.staged.files).toEqual([HERO_FILE]);
    expect((await proposal.client.get(proposal.name)).changes).toBe(0);
    expect(editor.errors()).toEqual([]);
  });

  test("C3 with code mode off a code write is refused, and nothing is written", async () => {
    const { world, proposal, editor } = await open();
    await editor.edit(before, ["title"], "Spring");
    await world.settle();

    const refused = await proposal.stage({ [HERO_FILE]: heroText });
    expect(refused).toEqual({
      isError: true,
      result: {
        success: false,
        error: expect.stringMatching(
          /^Code mode is not on in this proposal.*request_code_mode/,
        ),
      },
    });
    const files = await proposal.client.files(proposal.name);
    expect(files.files).toEqual({});
    // Not saved either: the pending edit is still pending.
    expect((await proposal.client.get(proposal.name)).changes).toBe(1);
  });

  test("C4 turning code mode off keeps everything, and the code tools refuse, saying who turned it off", async () => {
    const { world, proposal, editor } = await open();
    editor.reads("studio", before, ["title"]);
    await proposal.codeMode(true);
    expect((await proposal.stage({ [HERO_FILE]: heroText })).isError).toBe(
      false,
    );
    await editor.edit(before, ["title"], "Spring");
    await world.settle();

    const off = await proposal.codeMode(false);
    expect(off.codeMode).toEqual({
      on: false,
      changedBy: "profile-ada",
      changedAt: expect.any(String),
    });
    await world.settle();
    await world.observe();
    // The code stays; the edit stays, pending, and is not saved.
    const files = await proposal.client.files(proposal.name);
    expect(files.staged.files).toEqual([HERO_FILE]);
    expect(files.files[HOME_FILE]).toBeUndefined();
    expect(world.frames.last("studio")).toBe("Spring");
    expect((await proposal.client.get(proposal.name)).changes).toBe(1);

    const refused = await proposal.stage({ [HERO_FILE]: heroText });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.result)).toMatch(
      /Code mode is off in this proposal: someone turned it off/,
    );

    // On again: everything pending is saved first, so they cannot drift.
    await proposal.codeMode(true);
    expect(
      (await proposal.client.files(proposal.name)).files[HOME_FILE],
    ).toContain('"Spring"');
    expect(editor.errors()).toEqual([]);
  });

  /**
   * S10b, the reverting field, where it was reported: the assistant adds a
   * field in code mode and the editor types into it. The local-development
   * form in `addedField.scenario.test.ts` stays failing; see the note there.
   */
  test("C5 a field the assistant added is filled in and kept (S10b in code mode)", async () => {
    const { world, proposal, editor } = await open();
    world.page("/", { draftMode: false }).reads("proposal", async (val) => {
      const read = await val.fetchVal(after);
      return read.button?.label ?? "(absent)";
    });
    await editor.edit(before, ["title"], "Spring");
    await world.settle();
    await proposal.codeMode(true);

    // The assistant read the file -- which has "Spring", saved when code mode
    // came on -- and writes it back with a button.
    await world.changeCode([after], {
      [HOME_FILE]: afterText("Spring", "Buy"),
    });
    await world.settle();
    editor.reads("field", after, ["button", "label"]);
    editor.reads("title", after, ["title"]);
    await world.observe();

    await editor.edit(after, ["button", "label"], "Buy now");
    await world.settle();
    await world.observe();
    // The next code write saves it first.
    expect((await proposal.stage({ [HERO_FILE]: heroText })).isError).toBe(
      false,
    );
    await proposal.redeploy();
    await world.settle();
    await world.observe();

    expect(world.frames.last("field")).toBe("Buy now");
    expect(world.frames.last("title")).toBe("Spring");
    expect(world.frames.last("proposal")).toBe("Buy now");
    const files = await proposal.client.files(proposal.name);
    expect(files.files[HOME_FILE]).toContain('"Buy now"');
    expect(files.files[HOME_FILE]).toContain('"Spring"');
    world.frames.expectNeverGoesBack();
    expect(editor.errors()).toEqual([]);
  });

  /**
   * C11 A field the assistant adds can be typed into before the proposal is
   * built (phase 9, "Evaluating code after a write").
   *
   * After `write_files` stages a `.val.ts` that adds a field, the tab
   * evaluates `val.modules` (`runStagedCode`): the bundle loads, the Studio
   * swaps the new schema in (`reloadCode`), and `write_files` answers with
   * the module whose schema moved. The server at the address still runs the
   * build before the staging, whose base has no such field -- so the Studio
   * keeps the base its own (evaluated) code wrote for that module
   * (BaseAlignment's schema rule) and the edit applies at once. It is the
   * build's too once the platform builds what is staged.
   */
  test("C11 a field the assistant adds can be typed into before a build", async () => {
    const { world, proposal, editor } = await open();
    world.page("/", { draftMode: false }).reads("proposal", async (val) => {
      const read = await val.fetchVal(after);
      return read.button?.label ?? "(absent)";
    });
    await proposal.codeMode(true);
    editor.reads("field", after, ["button", "label"]);

    const staged = await proposal.stage(
      { [HOME_FILE]: afterText("Hello", "Buy") },
      "A button",
      { studio: editor, modules: [after] },
    );
    expect(staged.isError).toBe(false);
    expect(staged.result).toMatchObject({
      valModules: { status: "evaluated", schemaChanged: [HOME] },
    });
    await world.settle();
    await world.observe();
    expect(world.frames.last("field")).toBe("Buy");

    await editor.edit(after, ["button", "label"], "Buy now");
    await world.settle();
    await world.observe();
    expect(world.frames.last("field")).toBe("Buy now");

    // The assistant builds what it staged; then the next code write saves the
    // edit first, and the build after it has it. That write's code evaluates
    // to new instances of the same modules: nothing moved, so nothing is
    // swapped (compared by content, not by instance).
    await proposal.redeploy();
    await world.settle();
    const again = await proposal.stage({ [HERO_FILE]: heroText }, undefined, {
      studio: editor,
      modules: [afterAgain],
    });
    expect(again.isError).toBe(false);
    expect(again.result).toMatchObject({
      valModules: { status: "evaluated", schemaChanged: [] },
    });
    await proposal.redeploy();
    await world.settle();
    await world.observe();

    expect(world.frames.last("field")).toBe("Buy now");
    expect(world.frames.last("proposal")).toBe("Buy now");
    expect(world.network.log.filter((e) => e.method === "DELETE")).toEqual([]);
    world.frames.expectNeverGoesBack();
    expect(editor.errors()).toEqual([]);
  });

  /**
   * C11b An edit to a field only the STAGED code has is saved by the next code
   * write, before anybody builds.
   *
   * After a staging the platform serves the new overlay on the build the
   * address already runs (`stage`), and that build was not made of the
   * staging: its `VAL_BUILD_INPUTS` is not the overlay's `staged` version for
   * the module. So Val's server there reads the module's Source from its
   * staged text, versions it `staged:<inputs>`, and the save before the next
   * `write_files` applies the pending patch to that text and that Source --
   * not to the module as its build evaluated it, which has no `button` (the
   * commit failed with "Path refers to non-existing object/array" until the
   * server could tell). The page reads the module from its own code until a
   * build of the staging serves the address, never the Source saved under
   * the staged schema; then the saved edit is what it reads.
   */
  test("C11b the next code write saves an edit to a field only staged code has", async () => {
    const { world, proposal, editor } = await open();
    world.page("/", { draftMode: false }).reads("proposal", async (val) => {
      const read = await val.fetchVal(after);
      return read.button?.label ?? "(absent)";
    });
    await proposal.codeMode(true);
    editor.reads("field", after, ["button", "label"]);
    await proposal.stage(
      { [HOME_FILE]: afterText("Hello", "Buy") },
      "A button",
      { studio: editor, modules: [after] },
    );
    await world.settle();
    await editor.edit(after, ["button", "label"], "Buy now");
    await world.settle();

    expect((await proposal.stage({ [HERO_FILE]: heroText })).isError).toBe(
      false,
    );
    const files = await proposal.client.files(proposal.name);
    expect(files.files[HOME_FILE]).toContain('"Buy now"');
    expect((await proposal.client.get(proposal.name)).changes).toBe(0);
    await world.settle();
    await world.observe();
    // Not built: the page reads the module from its own bundle (the module
    // object it passes, whose label is "Buy"), never the Source the save
    // recorded under the staged schema, which only a build can read.
    expect(world.frames.last("proposal")).toBe("Buy");
    expect(world.frames.last("field")).toBe("Buy now");

    // Saved whole -- its Source too, not only its text: once the staging is
    // built, the address serves the edit.
    await proposal.redeploy();
    await world.settle();
    await world.observe();
    expect(world.frames.last("field")).toBe("Buy now");
    expect(world.frames.last("proposal")).toBe("Buy now");
    world.frames.expectNeverGoesBack();
    expect(editor.errors()).toEqual([]);
  });

  /**
   * C11c A module staged after the build whose content is not written out in
   * its `.val.ts` -- here its title is a constant -- cannot be read without
   * running it, and the server at the address does not run staged code. So a
   * save that touches it is HELD: the next code write is refused, saying
   * which module and that the proposal has to be built first, and the edit
   * stays pending. Once a build of the staging serves the address, the same
   * write saves it.
   */
  test("C11c an edit to a staged module the server cannot read is held until a build, and the assistant is told why", async () => {
    const { world, proposal, editor } = await open();
    await proposal.codeMode(true);
    const byCode = `import { c, s } from "../val.config";

const TITLE = "Hello";

export default c.define(
  "${HOME}",
  s.object({ title: s.string(), button: s.object({ label: s.string() }) }),
  { title: TITLE, button: { label: "Buy" } },
);
`;
    await proposal.stage({ [HOME_FILE]: byCode }, "A button", {
      studio: editor,
      modules: [after],
    });
    await world.settle();
    await editor.edit(after, ["button", "label"], "Buy now");
    await world.settle();

    const held = await proposal.stage({ [HERO_FILE]: heroText });
    expect(held.isError).toBe(true);
    expect(JSON.stringify(held.result)).toMatch(
      /content\/home\.val\.ts cannot be saved here: .*Build the proposal, then save/,
    );
    expect((await proposal.client.get(proposal.name)).changes).toBe(1);
    const files = await proposal.client.files(proposal.name);
    expect(files.staged.files).toEqual([HOME_FILE]);

    await proposal.redeploy();
    await world.settle();
    expect((await proposal.stage({ [HERO_FILE]: heroText })).isError).toBe(
      false,
    );
    const saved = await proposal.client.files(proposal.name);
    expect(saved.files[HOME_FILE]).toContain('"Buy now"');
    expect(saved.files[HOME_FILE]).toContain("title: TITLE");
    expect((await proposal.client.get(proposal.name)).changes).toBe(0);
    expect(editor.errors()).toEqual([]);
  });

  /**
   * C11d A module NEW in the proposal, which the build serving the address
   * does not have at all, is the editor's to fill in before a build, and its
   * edit is saved by the next code write -- never dropped.
   *
   * The assistant stages a new `.val.ts` (and registers it); the tab
   * evaluates the staging, so the Studio has the module and its schema. The
   * server at the address runs the build before the staging, which has no
   * such module: it must not take the Studio's module away (a build's
   * registry replaces, it does not merge), and the save before the next code
   * write must apply the edit to the staged text. The page, whose code does
   * not have the module, reads it once a build of the staging serves the
   * address.
   */
  test("C11d a module new in the proposal is edited, saved and served, never dropped", async () => {
    const { world, proposal, editor } = await open();
    world.page("/", { draftMode: false }).reads("proposal", async (val) => {
      const read = await val.fetchVal(promo);
      return read.headline;
    });
    await proposal.codeMode(true);
    editor.reads("field", promo, ["headline"]);

    const staged = await proposal.stage(
      { [PROMO_FILE]: promoText("Spring sale") },
      "A promo",
      { studio: editor, modules: [before, promo] },
    );
    expect(staged.isError).toBe(false);
    await world.settle();
    await world.observe();
    expect(world.frames.last("field")).toBe("Spring sale");

    await editor.edit(promo, ["headline"], "Spring sale, today");
    await world.settle();
    await world.observe();
    expect(world.frames.last("field")).toBe("Spring sale, today");

    // The next code write saves the edit into the staged text first.
    const next = await proposal.stage({ [HERO_FILE]: heroText }, undefined, {
      studio: editor,
      modules: [before, promo],
    });
    expect(next.isError).toBe(false);
    const files = await proposal.client.files(proposal.name);
    expect(files.files[PROMO_FILE]).toContain('"Spring sale, today"');
    expect((await proposal.client.get(proposal.name)).changes).toBe(0);
    await world.settle();
    await world.observe();
    expect(world.frames.last("field")).toBe("Spring sale, today");

    // Built: the address serves it, to the page too.
    await proposal.redeploy();
    await world.settle();
    await world.observe();
    expect(world.frames.last("field")).toBe("Spring sale, today");
    expect(world.frames.last("proposal")).toBe("Spring sale, today");
    world.frames.expectNeverGoesBack();
    expect(editor.errors()).toEqual([]);
  });

  /**
   * C11e A module new in the proposal whose content is made by code -- here
   * its headline is a constant -- cannot be read without running it, so an
   * edit to it is HELD, as C11c's is: the next code write is refused, saying
   * which module and to build the proposal first, and the edit stays
   * pending. Once a build of the staging serves the address, the same write
   * saves it.
   */
  test("C11e an edit to a new module the server cannot read is held until a build, and the assistant is told why", async () => {
    const { world, proposal, editor } = await open();
    await proposal.codeMode(true);
    const byCode = `import { c, s } from "../val.config";

const HEADLINE = "Spring sale";

export default c.define(
  "${PROMO}",
  s.object({ headline: s.string() }),
  { headline: HEADLINE },
);
`;
    await proposal.stage({ [PROMO_FILE]: byCode }, "A promo", {
      studio: editor,
      modules: [before, promo],
    });
    await world.settle();
    await editor.edit(promo, ["headline"], "Spring sale, today");
    await world.settle();

    const held = await proposal.stage({ [HERO_FILE]: heroText });
    expect(held.isError).toBe(true);
    expect(JSON.stringify(held.result)).toMatch(
      /content\/promo\.val\.ts cannot be saved here: .*Build the proposal, then save/,
    );
    expect((await proposal.client.get(proposal.name)).changes).toBe(1);

    await proposal.redeploy();
    await world.settle();
    expect((await proposal.stage({ [HERO_FILE]: heroText })).isError).toBe(
      false,
    );
    const saved = await proposal.client.files(proposal.name);
    expect(saved.files[PROMO_FILE]).toContain('"Spring sale, today"');
    expect((await proposal.client.get(proposal.name)).changes).toBe(0);
    expect(editor.errors()).toEqual([]);
  });

  /**
   * C11f A module whose own file is not staged, but which imports a file the
   * proposal staged after the build, is of code the build was not made of:
   * its schema moved with the import. The overlay names only staged MODULE
   * files, so the server reads it from what the build was made of -- its
   * source and the dependencies the build recorded per module -- and treats
   * the module as staged after the build: versioned as a staging, saved
   * against its text, and left out of what the page's readers read until a
   * build of the staging serves the address.
   */
  test("C11f a module whose imported schema is staged after the build is not read with the build's schema", async () => {
    const TITLE_FILE = "src/schemas/title.ts";
    const titleText = (schema: string) =>
      `import { s } from "../../val.config";\n\nexport const titleSchema = ${schema};\n`;
    const homeText = (title: string) => `import { c, s } from "../val.config";
import { titleSchema } from "../src/schemas/title";

export default c.define(
  "${HOME}",
  s.object({ title: titleSchema }),
  { title: ${JSON.stringify(title)} },
);
`;
    // What the staging evaluates to: the same module, its title capped.
    const capped = c.define(
      HOME,
      s.object({ title: s.string().maxLength(20) }),
      { title: "Hello" },
    );
    const w = await createWorld({
      config,
      modules: [before],
      server: "http",
      sourceText: {
        [HOME]: homeText("Hello"),
        [`/${TITLE_FILE}`]: titleText("s.string()"),
      },
      proposal: { open: "Spring campaign" },
      moduleDependencies: { [HOME_FILE]: [TITLE_FILE, "val.config.ts"] },
    });
    world = w;
    const proposal = w.proposal;
    if (proposal === null) throw new Error("not at a proposal's address");
    const editor = await w.studio("editor");
    w.page("/", { draftMode: false }).reads("proposal", async (val) => {
      return (await val.fetchVal(capped)).title;
    });
    await proposal.codeMode(true);
    editor.reads("field", capped, ["title"]);

    // Only the imported file is staged: `home.val.ts` is not.
    const staged = await proposal.stage(
      { [TITLE_FILE]: titleText("s.string().maxLength(20)") },
      "Cap the title",
      { studio: editor, modules: [capped] },
    );
    expect(staged.isError).toBe(false);
    await w.settle();
    const manifest = await w.manifest();
    expect(
      manifest.modules[HOME as keyof typeof manifest.modules]?.schema,
    ).toMatch(/^staged:[0-9a-f]{64}$/);

    await editor.edit(capped, ["title"], "Spring");
    await w.settle();
    const next = await proposal.stage({ [HERO_FILE]: heroText }, undefined, {
      studio: editor,
      modules: [capped],
    });
    expect(next.isError).toBe(false);
    expect(
      (await proposal.client.files(proposal.name)).files[HOME_FILE],
    ).toContain('"Spring"');
    await w.settle();
    await w.observe();
    // Not built: the page reads the module from its own bundle, never the
    // Source saved for code it has not got.
    expect(w.frames.last("proposal")).toBe("Hello");
    expect(w.frames.last("field")).toBe("Spring");

    // Built: the build is made of the staging, and serves the saved edit.
    await proposal.redeploy();
    await w.settle();
    await w.observe();
    expect(w.frames.last("proposal")).toBe("Spring");
    expect(w.frames.last("field")).toBe("Spring");
    expect(editor.errors()).toEqual([]);
  });

  /**
   * C12 Staged code that does not run leaves the Studio on the schema it had,
   * and the assistant is told why.
   */
  test("C12 a staged .val.ts that throws: the Studio keeps its schema, and the assistant is told", async () => {
    const { world, proposal, editor } = await open();
    await proposal.codeMode(true);
    const schemas = editor.system.schemaStore.all();

    const staged = await proposal.stage(
      { [HOME_FILE]: "export default oops(;\n" },
      "Broken",
      {
        studio: editor,
        modules: {
          config,
          modules: [
            {
              def: () =>
                Promise.reject(new Error("home.val.ts: oops is not defined")),
            },
          ],
        },
      },
    );
    expect(staged.isError).toBe(false);
    expect(staged.result).toMatchObject({
      valModules: {
        status: "does-not-evaluate",
        error: "home.val.ts: oops is not defined",
      },
    });
    await world.settle();
    expect(editor.system.schemaStore.all()).toBe(schemas);
    expect(editor.errors()).toEqual([]);
  });

  test("C6 Commit is refused when someone else pushed to the branch: who, and their commit", async () => {
    const { world, proposal, editor } = await open();
    await editor.edit(before, ["title"], "Spring");
    await world.settle();
    await proposal.codeMode(true);

    const first = await proposal.commit("Spring campaign");
    expect(first).toEqual({
      status: "committed",
      url: expect.stringMatching(/\/commit\/[0-9a-f]{40}$/),
      branch: `val/p/${proposal.name}`,
      pushed: true,
    });
    // Nothing saved since: nothing pushed, the same commit.
    expect(await proposal.commit("Again")).toEqual({
      ...first,
      pushed: false,
    });

    await proposal.someonePushes({
      author: "Ada Lovelace",
      message: "Fix the hero's spacing",
    });
    await editor.edit(before, ["title"], "Spring sale");
    await world.settle();
    expect((await editor.publish()).status).toBe("published");

    const refused = await proposal.commit("Spring sale");
    expect(refused).toEqual({
      status: "someone-pushed",
      message: expect.stringMatching(
        /^Ada Lovelace pushed to val\/p\/[0-9a-f]{20} \([0-9a-f]{7}\) at .* UTC\. Val does not commit over a push it has not seen\.$/,
      ),
      branch: `val/p/${proposal.name}`,
      branchUrl: expect.stringContaining(`/tree/val/p/${proposal.name}`),
      who: "Ada Lovelace",
      ago: "just now",
      theirs: {
        sha: expect.stringMatching(/^[0-9a-f]{40}$/),
        url: expect.stringMatching(/\/commit\/[0-9a-f]{40}$/),
        message: "Fix the hero's spacing",
      },
    });
    // Publish commits first, and is refused the same way: nothing merges.
    await expect(proposal.merge("Spring sale")).rejects.toThrow(
      /Val does not commit over a push it has not seen/,
    );
    expect((await proposal.client.get(proposal.name)).status).toBe("open");
    expect(editor.errors()).toEqual([]);
  });
  /**
   * A developer pushed to the proposal's branch, so Commit is refused; Build
   * on their push brings their push in, and Commit goes on top of it.
   */
  test("C7 build on their push: their files come in, a file both changed keeps the proposal's, and Commit and Publish go on top of theirs", async () => {
    const { world, proposal, editor } = await open();
    world
      .page("/", { draftMode: false, at: "site" })
      .reads("site", (val) => val.fetchVal(before).then((read) => read.title));
    await editor.edit(before, ["title"], "Spring");
    await world.settle();
    await proposal.codeMode(true);
    const first = await proposal.commit("Spring campaign");
    expect(first.status).toBe("committed");

    // Ada changes the hero, and the page's file -- which the proposal changed too.
    const theirSha = await proposal.someonePushes({
      author: "Ada Lovelace",
      message: "Fix the hero's spacing",
      files: { [HERO_FILE]: heroText, [HOME_FILE]: beforeText("From git") },
    });
    // An edit made after, not saved yet: building on their push saves it first.
    await editor.edit(before, ["title"], "Spring sale");
    await world.settle();

    const refused = await proposal.commit("Spring sale");
    if (refused.status !== "someone-pushed") throw new Error(refused.status);
    expect(refused.theirs.sha).toBe(theirSha);

    const taken = await proposal.buildOnTheirPush(refused.theirs.sha);
    expect(taken).toEqual({
      status: "taken",
      kept: [HOME_FILE],
      taken: [HERO_FILE],
      notTaken: [],
      rewritten: false,
      proposal: expect.objectContaining({ name: proposal.name }),
      theirs: { sha: theirSha, url: expect.stringContaining(theirSha) },
    });
    // Pressed again (a retry): the same answer, nothing taken twice.
    expect(await proposal.buildOnTheirPush(theirSha)).toMatchObject({
      status: "taken",
      kept: [HOME_FILE],
      taken: [HERO_FILE],
    });

    const files = await proposal.client.files(proposal.name);
    expect(files.files[HERO_FILE]).toBe(heroText);
    // The proposal's version, with the edit saved first -- not theirs.
    expect(files.files[HOME_FILE]).toContain('"Spring sale"');
    expect(files.files[HOME_FILE]).not.toContain("From git");
    expect(files.staged.files).toContain(HERO_FILE);
    const now = await proposal.client.get(proposal.name);
    expect(now.changes).toBe(0);
    expect(now.git).toMatchObject({
      committed: { sha: theirSha, by: null },
      uncommitted: true,
      takenIn: { sha: theirSha, building: true },
    });

    // Commit goes through now, on top of their commit.
    const onTop = await proposal.commit("Spring sale, on top of Ada's");
    expect(onTop).toEqual({
      status: "committed",
      url: expect.stringMatching(/\/commit\/[0-9a-f]{40}$/),
      branch: `val/p/${proposal.name}`,
      pushed: true,
    });
    if (onTop.status !== "committed") throw new Error(onTop.status);
    expect(onTop.url).not.toContain(theirSha);
    expect(onTop.url).not.toBe(first.status === "committed" ? first.url : "");

    // Publish waits for a build with their code, and says so.
    const checks = await proposal.client.mergeChecks(proposal.name);
    expect(checks.checks).toContainEqual({
      id: "taken-push",
      ok: false,
      message: expect.stringContaining(theirSha.slice(0, 7)),
      action: "build",
    });
    await expect(proposal.merge("Spring sale")).rejects.toThrow(
      /not in the proposal's build yet/,
    );

    const build = await proposal.build();
    expect(build.status).toBe("built");
    expect(proposal.built.at(-1)?.[HERO_FILE]).toBe(heroText);
    expect(
      (await proposal.client.mergeChecks(proposal.name)).checks,
    ).toContainEqual(expect.objectContaining({ id: "taken-push", ok: true }));
    await proposal.redeploy();
    await world.settle();

    const pressed = await proposal.merge("Spring sale");
    expect(pressed.request.kind).toBe("live");
    await world.observe();
    expect(world.frames.last("site")).toBe("Spring sale");
    // Their file is on the site with the proposal's content.
    expect(await siteFile(world, HERO_FILE)).toBe(heroText);
    expect(await siteFile(world, HOME_FILE)).toContain('"Spring sale"');
    expect(editor.errors()).toEqual([]);
  });

  /**
   * Their push moved again between the refusal and the press: the press is
   * refused naming the newer push, and building on that one brings in both.
   * Here it is Publish that was refused, read as the Studio reads it.
   */
  test("C8 their push moved again before Build on their push: the newer push is named, and building on it brings in both", async () => {
    const { world, proposal, editor } = await open();
    await editor.edit(before, ["title"], "Spring");
    await world.settle();
    await proposal.codeMode(true);
    expect((await proposal.commit("Spring campaign")).status).toBe("committed");

    const firstSha = await proposal.someonePushes({
      author: "Ada Lovelace",
      message: "Fix the hero's spacing",
      files: { [HERO_FILE]: heroText },
    });
    const refusal = await proposal.merge("Spring").then(
      () => null,
      (error: unknown) => publishCommitRefusalOf(error),
    );
    if (refusal?.status !== "someone-pushed") {
      throw new Error(`Publish was not refused as someone pushed`);
    }
    expect(refusal.theirs.sha).toBe(firstSha);
    expect(refusal.who).toBe("Ada Lovelace");

    // Ada pushes again before anyone presses.
    const secondSha = await proposal.someonePushes({
      author: "Ada Lovelace",
      message: "And a footer",
      files: { [FOOTER_FILE]: footerText },
    });
    const moved = await proposal.buildOnTheirPush(firstSha);
    expect(moved).toMatchObject({
      status: "someone-pushed",
      who: "Ada Lovelace",
      theirs: { sha: secondSha, message: "And a footer" },
    });
    // Nothing came in from the press that was refused.
    const unchanged = await proposal.client.files(proposal.name);
    expect(unchanged.files[HERO_FILE]).toBeUndefined();

    if (moved.status !== "someone-pushed") throw new Error(moved.status);
    const taken = await proposal.buildOnTheirPush(moved.theirs.sha);
    expect(taken).toMatchObject({
      status: "taken",
      kept: [],
      taken: [HERO_FILE, FOOTER_FILE],
    });
    const files = await proposal.client.files(proposal.name);
    expect(files.files[HERO_FILE]).toBe(heroText);
    expect(files.files[FOOTER_FILE]).toBe(footerText);

    expect((await proposal.build()).status).toBe("built");
    await proposal.redeploy();
    await world.settle();
    const pressed = await proposal.merge("Spring");
    expect(pressed.request.kind).toBe("live");
    expect(await siteFile(world, FOOTER_FILE)).toBe(footerText);
    expect(editor.errors()).toEqual([]);
  });

  /**
   * With nothing left to take in -- the branch is where Val left it -- the
   * press says so, and Commit is what goes next.
   */
  test("C9 with nothing of theirs left to take in, Build on their push says so, and Commit goes", async () => {
    const { world, proposal, editor } = await open();
    await editor.edit(before, ["title"], "Spring");
    await world.settle();
    await proposal.codeMode(true);
    const first = await proposal.commit("Spring campaign");
    if (first.status !== "committed") throw new Error(first.status);
    const sha = first.url.slice(-40);

    expect(await proposal.buildOnTheirPush(sha)).toEqual({
      status: "nothing-to-take",
      message: expect.stringMatching(/nothing to take in/i),
    });
    expect((await proposal.commit("Again")).status).toBe("committed");
  });
  /**
   * A file the proposal holds only because an earlier push of theirs was
   * taken in is theirs, not the proposal's: their next push takes it again.
   */
  test("C10 a file that came from their earlier push is taken again from their next one, not kept", async () => {
    const { world, proposal, editor } = await open();
    await editor.edit(before, ["title"], "Spring");
    await world.settle();
    await proposal.codeMode(true);
    expect((await proposal.commit("Spring campaign")).status).toBe("committed");
    const first = await proposal.someonePushes({
      author: "Ada Lovelace",
      message: "Fix the hero's spacing",
      files: { [HERO_FILE]: heroText },
    });
    expect((await proposal.buildOnTheirPush(first)).status).toBe("taken");
    expect((await proposal.commit("On top of Ada's")).status).toBe("committed");

    const heroAgain = heroText.replace("Hero", "Hero, again");
    const second = await proposal.someonePushes({
      author: "Ada Lovelace",
      message: "The hero, again",
      files: { [HERO_FILE]: heroAgain },
    });
    const refused = await proposal.commit("Spring");
    expect(refused).toMatchObject({
      status: "someone-pushed",
      theirs: { sha: second },
    });
    expect(await proposal.buildOnTheirPush(second)).toMatchObject({
      status: "taken",
      kept: [],
      taken: [HERO_FILE],
    });
    expect((await proposal.client.files(proposal.name)).files[HERO_FILE]).toBe(
      heroAgain,
    );
    expect(editor.errors()).toEqual([]);
  });
});

/** A file of the site's, as the content host's last commit left it. */
async function siteFile(
  world: World,
  filePath: string,
): Promise<string | null> {
  if (world.server.mode !== "http") throw new Error("only on http");
  const res = await fetch(
    `${world.server.contentUrl}/__test__/committed-source?path=${encodeURIComponent(`/${filePath}`)}`,
  );
  const answer: unknown = await res.json();
  return typeof answer === "object" &&
    answer !== null &&
    "content" in answer &&
    typeof answer.content === "string"
    ? answer.content
    : null;
}
