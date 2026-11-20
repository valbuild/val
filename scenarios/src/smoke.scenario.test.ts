import { readdirSync } from "node:fs";
import { join } from "node:path";
import { initVal } from "@valbuild/core";
import { createWorld, type World } from "./world/createWorld";

// The framework's request context, which Val's readers read draft mode and the
// session through. See `world/tanstackStart.ts`.
jest.mock(
  "@tanstack/react-start/server",
  () => jest.requireActual("./world/tanstackStart"),
  { virtual: true },
);
// The Studio's validation worker, which jest cannot load. Never called: the
// world validates in-process. See `world/noWorkerBridge.ts`.
jest.mock("../../packages/ui/spa/validation/schemaValidationBridge", () =>
  jest.requireActual("./world/noWorkerBridge"),
);

const { s, c, config } = initVal({});

const homeVal = c.define(
  "/content/home.val.ts",
  s.object({ title: s.string() }),
  { title: "Hello" },
);

describe.each(["memory", "fs", "http"] as const)("smoke, on %s", (server) => {
  let world: World | null = null;
  afterEach(async () => {
    await world?.dispose();
    world = null;
  });

  test("an edit in the Studio reaches the page's fetchVal in draft mode", async () => {
    world = await createWorld({ config, modules: [homeVal], server });
    const studio = await world.studio("editor");
    const page = world.page("/", { draftMode: true });

    studio.reads("field", homeVal, ["title"]);
    page.reads("loader", async (val) => (await val.fetchVal(homeVal)).title);

    await world.observe();
    await studio.edit(homeVal, ["title"], "Hello world");
    await world.observe(); // the Studio has it; the server may not yet
    await world.settle();
    await world.observe();

    world.expectInvariants();
    expect(world.frames.last("field")).toBe("Hello world");
    expect(world.frames.last("loader")).toBe("Hello world");
    if (world.server.mode === "fs") {
      // fs mode for real: the edit is in the project's own patch store.
      expect(
        readdirSync(join(world.server.root, ".val", "patches")),
      ).not.toEqual([]);
    }
  });

  test("with draft mode off, the page shows the published content", async () => {
    world = await createWorld({ config, modules: [homeVal], server });
    const studio = await world.studio("editor");
    const page = world.page("/", { draftMode: false });
    page.reads("loader", async (val) => (await val.fetchVal(homeVal)).title);

    await studio.edit(homeVal, ["title"], "Hello world");
    await world.settle();
    await world.observe();

    expect(world.frames.last("loader")).toBe("Hello");
  });
});
