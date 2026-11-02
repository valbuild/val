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
 * Proposals, in the http world: Val's server at a proposal's address
 * (`VAL_PROPOSAL`, `VAL_BRANCH`, `VAL_OVERLAY`) against the mock content
 * host, which keeps a chain per branch, saves and stagings as commits on the
 * proposal's branch, and the overlay the platform serves the address from
 * (see "Proposals" in the README for what the mock does not do).
 *
 * The world opens the proposal the way New proposal does on the site
 * (`createProposalsClient().create`), stages code through the assistant's
 * `write_files` (`runCodeTool`), and presses Publish in it with the Studio's
 * `pressMerge`. A save is the Studio's own publish, which at a proposal's
 * address is a commit on its branch.
 */

const { s, c, config } = initVal({});
const HOME = "/content/home.val.ts";
const homeVal = c.define(HOME, s.object({ title: s.string() }), {
  title: "Hello",
});
const homeText = (title: string) => `import { c, s } from "../val.config";

export default c.define(
  "${HOME}",
  s.object({ title: s.string() }),
  { title: ${JSON.stringify(title)} },
);
`;
const sourceText = { [HOME]: homeText("Hello") };

const title = async (val: {
  fetchVal(module: typeof homeVal): Promise<{ title: string }>;
}) => (await val.fetchVal(homeVal)).title;

describe("a proposal, on http", () => {
  let world: World | null = null;
  afterEach(async () => {
    await world?.dispose();
    world = null;
  });

  const open = async () => {
    world = await createWorld({
      config,
      modules: [homeVal],
      server: "http",
      sourceText,
      proposal: { open: "Spring campaign" },
    });
    const proposal = world.proposal;
    if (proposal === null) throw new Error("not at a proposal's address");
    return { world, proposal };
  };

  test("S26 an edit in a proposal is not on the site", async () => {
    const { world, proposal } = await open();
    const editor = await world.studio("editor");
    editor.reads("studio", homeVal, ["title"]);
    world.page("/", { draftMode: true }).reads("proposal draft", title);
    world.page("/", { draftMode: true, at: "site" }).reads("site draft", title);
    world.page("/", { draftMode: false, at: "site" }).reads("site", title);

    await editor.edit(homeVal, ["title"], "Spring");
    await world.settle();
    await world.observe();

    expect(world.frames.last("studio")).toBe("Spring");
    expect(world.frames.last("proposal draft")).toBe("Spring");
    expect(world.frames.last("site draft")).toBe("Hello");
    expect(world.frames.last("site")).toBe("Hello");
    expect(editor.errors()).toEqual([]);
    const files = await proposal.client.files(proposal.name);
    expect(files.files).toEqual({});
  });

  test("S27 a save makes it the proposal's, and leaves the site", async () => {
    const { world, proposal } = await open();
    const editor = await world.studio("editor");
    world.page("/", { draftMode: false }).reads("proposal", title);
    world.page("/", { draftMode: false, at: "site" }).reads("site", title);

    await editor.edit(homeVal, ["title"], "Spring");
    await world.settle();
    const saved = await editor.publish();
    expect(saved.status).toBe("published");
    await world.settle();
    // The platform serves the address from the overlay the save made.
    await proposal.redeploy();
    await world.settle();
    await world.observe();

    expect(world.frames.last("proposal")).toBe("Spring");
    expect(world.frames.last("site")).toBe("Hello");
    const files = await proposal.client.files(proposal.name);
    expect(files.files["content/home.val.ts"]).toContain('"Spring"');
    expect(editor.errors()).toEqual([]);
  });

  test("S28 two editors in one proposal see each other's edits and one save", async () => {
    const { world, proposal } = await open();
    const ada = await world.studio("editor");
    const bo = await world.studio("other");
    ada.reads("ada", homeVal, ["title"]);
    bo.reads("bo", homeVal, ["title"]);
    world.page("/", { draftMode: true, at: "site" }).reads("site draft", title);

    await ada.edit(homeVal, ["title"], "Spring");
    await world.settle();
    await world.observe();
    expect(world.frames.last("bo")).toBe("Spring");

    await bo.edit(homeVal, ["title"], "Spring sale");
    await world.settle();
    await world.observe();
    expect(world.frames.last("ada")).toBe("Spring sale");

    const saved = await ada.publish();
    expect(saved.status).toBe("published");
    await proposal.redeploy();
    await world.settle();
    await world.observe();
    expect(world.frames.last("ada")).toBe("Spring sale");
    expect(world.frames.last("bo")).toBe("Spring sale");
    expect(world.frames.last("site draft")).toBe("Hello");
    world.frames.expectNeverGoesBack();
    expect([...ada.errors(), ...bo.errors()]).toEqual([]);
  });

  test("S29 a staged .val.ts change is the proposal's Source, through write_files", async () => {
    const { world, proposal } = await open();
    const editor = await world.studio("editor");
    world.page("/", { draftMode: false }).reads("proposal", title);
    world.page("/", { draftMode: false, at: "site" }).reads("site", title);
    // A save first: content records a staged module's Source only for a
    // module the proposal already has a version of (valbuild/home#369).
    await editor.edit(homeVal, ["title"], "Spring");
    await world.settle();
    expect((await editor.publish()).status).toBe("published");

    const staged = await proposal.stage(
      { "content/home.val.ts": homeText("Staged in code") },
      "Retitle in code",
    );
    expect(staged).toEqual({
      isError: false,
      result: expect.objectContaining({
        success: true,
        staged: ["content/home.val.ts"],
      }),
    });
    await proposal.redeploy();
    await world.settle();
    await world.observe();

    expect(world.frames.last("proposal")).toBe("Staged in code");
    expect(world.frames.last("site")).toBe("Hello");
  });

  test("S30 publish in a proposal merges it into the site", async () => {
    const { world, proposal } = await open();
    const editor = await world.studio("editor");
    world.page("/", { draftMode: false, at: "site" }).reads("site", title);
    await editor.edit(homeVal, ["title"], "Spring");
    await world.settle();
    expect((await editor.publish()).status).toBe("published");
    await world.observe();
    expect(world.frames.last("site")).toBe("Hello");

    const pressed = await proposal.merge();
    expect(pressed.request.kind).toBe("live");
    await world.observe();

    expect(world.frames.last("site")).toBe("Spring");
    expect((await proposal.client.get(proposal.name)).status).toBe("merged");
  });
});
