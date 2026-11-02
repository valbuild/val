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
 * Code mode (`docs/plans/one-content-model.md`, "Code mode"), in the http
 * world at a proposal's address: content and code are never in two places
 * when code changes.
 *
 * Every action is the product's: code mode is turned on and off with the
 * call the `</>` and the assistant's card make (`ProposalsClient.setCodeMode`),
 * code is written through the assistant's `write_files` (`runCodeTool`, with
 * the code-mode check the Studio's assistant gives it), and Commit is the
 * Studio's `commitProposal`. The saves before a code write are Val's
 * server's (`beforeProposalCodeWrite`), not the world's.
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
const heroText = `export function Hero() {\n  return <h1>Hero</h1>;\n}\n`;

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
});
