import { initVal } from "@valbuild/core";
import { createWorld, type World } from "./world/createWorld";
import {
  reportCodeMode,
  resetCodeMode,
} from "../../packages/ui/spa/proposals/codeMode";
import { resetStagedCode } from "../../packages/ui/spa/proposals/stagedCode";

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
 * What the assistant's code tools ASK THE SERVER FOR, tool by tool, in a
 * proposal on http: counted, never timed. Each request here is a round trip
 * from the tab through the app's relay to the content service, and a turn
 * waits for every one of them before the model hears back.
 *
 * The tools run as `useAI` runs them (`ProposalAt.assistant`): one
 * `createCodeClients` for the chat, whose snapshot of the project
 * (`projectSnapshot.ts`) is anchored on the Studio's own `seq`, against Val's
 * real server and the content host. What was asked before the snapshot is in
 * each test's name or comment, from the same tools on the commit before it.
 */

const { s, c, config } = initVal({});
const HOME = "/content/home.val.ts";
const HOME_FILE = "content/home.val.ts";
const HERO_FILE = "src/components/Hero.tsx";
const FOOTER_FILE = "src/components/Footer.tsx";

const before = c.define(HOME, s.object({ title: s.string() }), {
  title: "Hello",
});
const after = c.define(
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
const afterText = `import { c, s } from "../val.config";

export default c.define(
  "${HOME}",
  s.object({ title: s.string(), button: s.object({ label: s.string() }) }),
  { title: "Hello", button: { label: "Buy" } },
);
`;
const heroText = [
  "export function Hero() {",
  "  return <h1>Hero</h1>;",
  "}",
  "export function Sub() {",
  "  return <h2>Sub</h2>;",
  "}",
  "export function Cta() {",
  "  return <a>Go</a>;",
  "}",
  "",
].join("\n");
const footerText = `export function Footer() {\n  return <footer>Footer</footer>;\n}\n`;

describe("what the code tools ask the server for", () => {
  let world: World | null = null;
  afterEach(async () => {
    await world?.dispose();
    world = null;
    resetCodeMode();
    resetStagedCode();
  });

  /** A proposal in code mode, with the tab's top bar knowing it is on. */
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
    const turned = await proposal.codeMode(true);
    // What `useProposalsBar` does with the proposal it reads.
    reportCodeMode({
      name: proposal.name,
      displayName: turned.displayName,
      on: true,
    });
    await world.settle();
    const files = `/api/val/proposals-api/${proposal.name}/files`;
    const one = `/api/val/proposals-api/${proposal.name}`;
    const source = "/api/val/publish-api/project-source";
    return { world, proposal, editor, files, one, source };
  };

  test("reading: the project is asked for once, then every read, search and listing is answered from the tab (before: two requests each)", async () => {
    const { world, proposal, editor, files, source } = await open();
    await proposal.stage({ [HERO_FILE]: heroText });
    await world.settle();
    const assistant = proposal.assistant(editor);

    const first = await assistant.run("read_file", { path: HERO_FILE });
    expect(first.isError).toBe(false);
    expect(assistant.requests().sort()).toEqual(
      [`GET ${files}`, `GET ${source}`].sort(),
    );

    for (let read = 0; read < 4; read++) {
      await assistant.run("read_file", { path: HERO_FILE });
    }
    await assistant.run("search_code", { query: "c.define" });
    await assistant.run("list_files", {});
    await assistant.run("lint", {});
    expect(assistant.requests()).toEqual([]);
  });

  test("writing: a write is one request (before: four, and three more to evaluate it), and three edits in one reply are three", async () => {
    const { world, proposal, editor, files, source } = await open();
    const assistant = proposal.assistant(editor);
    await assistant.run("list_files", {});
    assistant.requests();

    const written = await assistant.run("write_files", {
      files: { [HERO_FILE]: heroText },
    });
    expect(written.isError).toBe(false);
    expect(assistant.requests()[0]).toBe(`POST ${files}`);
    await world.settle();
    assistant.requests();

    // One reply, three edits of one file: each reads what the one before
    // wrote, from the tab.
    const edits = await Promise.all([
      assistant.run("edit_file", {
        path: HERO_FILE,
        old_string: "<h1>Hero</h1>",
        new_string: "<h1>Spring</h1>",
      }),
      assistant.run("edit_file", {
        path: HERO_FILE,
        old_string: "<h2>Sub</h2>",
        new_string: "<h2>Sale</h2>",
      }),
      assistant.run("edit_file", {
        path: HERO_FILE,
        old_string: "<a>Go</a>",
        new_string: "<a>Buy</a>",
      }),
    ]);
    expect(edits.map((edit) => edit.isError)).toEqual([false, false, false]);
    // The tab hears of its own stagings (`seq` moved), and reads the
    // project again by itself, behind the edits: none of them waits for it
    // (`projectSnapshot.test.ts` holds the read back to show that).
    await world.settle();
    const asked = assistant.requests();
    expect(asked.filter((request) => request.startsWith("POST"))).toEqual([
      `POST ${files}`,
      `POST ${files}`,
      `POST ${files}`,
    ]);
    const rereads = asked.filter((request) => request === `GET ${files}`);
    expect(rereads.length).toBeGreaterThanOrEqual(1);
    expect(rereads.length).toBeLessThanOrEqual(3);
    expect(
      asked.filter(
        (request) =>
          ![`POST ${files}`, `GET ${files}`, `GET ${source}`].includes(request),
      ),
    ).toEqual([]);

    const read = await assistant.run("read_file", { path: HERO_FILE });
    expect(assistant.requests()).toEqual([]);
    expect(read.result).toMatchObject({
      text: heroText
        .replace("<h1>Hero</h1>", "<h1>Spring</h1>")
        .replace("<h2>Sub</h2>", "<h2>Sale</h2>")
        .replace("<a>Go</a>", "<a>Buy</a>"),
    });
    // And it is what the content service holds.
    expect(read.result).toMatchObject({
      text: (await proposal.client.files(proposal.name)).files[HERO_FILE],
    });
  });

  test("format_files stages what changed in one request, and reads nothing", async () => {
    const { world, proposal, editor, files } = await open();
    const assistant = proposal.assistant(editor);
    await assistant.run("write_files", { files: { [HERO_FILE]: heroText } });
    await world.settle();
    await assistant.run("read_file", { path: HERO_FILE });
    assistant.requests();

    const formatted = await assistant.run(
      "format_files",
      { paths: [HERO_FILE] },
      {
        // Stands in for prettier.
        formatCode: async (text) => ({
          status: "formatted",
          text: text.replace("<h1>Hero</h1>", "<h1>\n      Hero\n    </h1>"),
        }),
      },
    );
    expect(formatted.isError).toBe(false);
    expect(assistant.requests()[0]).toBe(`POST ${files}`);
    const read = await assistant.run("read_file", { path: HERO_FILE });
    expect(read.result).toMatchObject({
      text: expect.stringContaining("<h1>\n      Hero\n    </h1>"),
    });
  });

  test("a write that saved content first leaves the files in doubt: the next read asks, and has the saved content", async () => {
    const { world, proposal, editor, files } = await open();
    const assistant = proposal.assistant(editor);
    await assistant.run("list_files", {});
    await editor.edit(before, ["title"], "Spring");
    await world.settle();
    assistant.requests();

    // Val's server saves the pending edit before it stages: `HOME_FILE`
    // changes in the proposal, and this tab did not write it.
    await assistant.run("write_files", { files: { [HERO_FILE]: heroText } });
    const read = await assistant.run("read_file", { path: HOME_FILE });
    expect(assistant.requests()).toEqual(
      expect.arrayContaining([`POST ${files}`, `GET ${files}`]),
    );
    expect(read.result).toMatchObject({
      text: expect.stringContaining('"Spring"'),
    });
  });

  test("two assistants in one proposal: an edit is made on the other's change, not over it", async () => {
    const { world, proposal, editor, files } = await open();
    const other = await world.studio("other");
    await world.settle();
    const mine = proposal.assistant(editor);
    const theirs = proposal.assistant(other);
    await mine.run("write_files", { files: { [HERO_FILE]: heroText } });
    await world.settle();
    await mine.run("read_file", { path: HERO_FILE });
    mine.requests();

    const their = await theirs.run("edit_file", {
      path: HERO_FILE,
      old_string: "<h2>Sub</h2>",
      new_string: "<h2>Theirs</h2>",
    });
    expect(their.isError).toBe(false);
    // Their staging moved the project's `seq`, and this tab hears.
    await world.settle();

    const edit = await mine.run("edit_file", {
      path: HERO_FILE,
      old_string: "<h1>Hero</h1>",
      new_string: "<h1>Mine</h1>",
    });
    expect(edit.isError).toBe(false);
    // What it held was not current, so it asked before it wrote.
    const asked = mine.requests();
    expect(asked).toContain(`GET ${files}`);
    expect(asked[asked.length - 1]).toBe(`POST ${files}`);
    const now = (await proposal.client.files(proposal.name)).files[HERO_FILE];
    expect(now).toContain("<h1>Mine</h1>");
    expect(now).toContain("<h2>Theirs</h2>");
  });

  test("code mode turned off mid-turn: the write is refused by the server in one request, and the model is told who turned it off", async () => {
    const { world, proposal, editor, files } = await open();
    const assistant = proposal.assistant(editor);
    await assistant.run("list_files", {});
    // Someone turns it off, and this tab's top bar has not read it yet.
    await proposal.codeMode(false);
    await world.settle();
    assistant.requests();

    const refused = await assistant.run("write_files", {
      files: { [HERO_FILE]: heroText },
    });
    expect(refused).toEqual({
      isError: true,
      result: {
        success: false,
        error: expect.stringMatching(
          /^Code mode is off in this proposal: someone turned it off .*so its code cannot be changed now\. Nothing was written\. .*request_code_mode/,
        ),
      },
    });
    expect(
      assistant.requests().filter((request) => request !== `GET ${files}`),
    ).toEqual([`POST ${files}`]);
    expect(
      (await proposal.client.files(proposal.name)).files[HERO_FILE],
    ).toBeUndefined();

    // Once the tab knows it is off, it asks first, as before, and says the same.
    reportCodeMode({ name: proposal.name, displayName: "Spring", on: false });
    const again = await assistant.run("write_files", {
      files: { [HERO_FILE]: heroText },
    });
    expect(again).toEqual(refused);
  });

  test("evaluating the staged code: a component is not waited for, a file the Val modules do not read is not evaluated at all, and a .val.ts still reaches the Studio before a build", async () => {
    const { proposal, editor } = await open();
    editor.reads("studio", before, ["title"]);
    const assistant = proposal.assistant(editor);

    // Nothing was evaluated in this tab yet, so what the bundle reads is not
    // known: evaluated, and the answer does not wait for it.
    const hero = await assistant.run(
      "write_files",
      { files: { [HERO_FILE]: heroText } },
      { evaluateIn: { modules: [before] } },
    );
    expect(hero.result).not.toHaveProperty("valModules");
    await world?.settle();
    expect(assistant.evaluations()).toBe(1);

    // Now it is known: a component the Val modules never import changes
    // nothing there, and nothing is evaluated.
    const footer = await assistant.run(
      "write_files",
      { files: { [FOOTER_FILE]: footerText } },
      { evaluateIn: { modules: [before] } },
    );
    expect(footer.result).not.toHaveProperty("valModules");
    await world?.settle();
    expect(assistant.evaluations()).toBe(1);

    // A schema change is evaluated, waited for, and in the Studio at once.
    const schema = await assistant.run(
      "write_files",
      { files: { [HOME_FILE]: afterText } },
      { evaluateIn: { modules: [after] } },
    );
    expect(schema.result).toMatchObject({
      valModules: { status: "evaluated", schemaChanged: [HOME] },
    });
    expect(assistant.evaluations()).toBe(2);
    expect(
      Object.entries(editor.system.schemaStore.all()).find(
        ([moduleFilePath]) => moduleFilePath === HOME,
      )?.[1],
    ).toMatchObject({
      type: "object",
      items: { button: { type: "object" } },
    });
  });
});
