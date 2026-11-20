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

const { s, c, config } = initVal({});

const homeVal = c.define(
  "/content/home.val.ts",
  s.object({ title: s.string() }),
  { title: "Hello" },
);

describe.each(["memory", "fs", "http"] as const)(
  "two editors, on %s",
  (server) => {
    let world: World | null = null;
    afterEach(async () => {
      await world?.dispose();
      world = null;
    });

    test("an edit by one editor reaches the other's field through /stat", async () => {
      world = await createWorld({ config, modules: [homeVal], server });
      const ada = await world.studio("ada");
      const bo = await world.studio("bo");
      ada.reads("ada", homeVal, ["title"]);
      bo.reads("bo", homeVal, ["title"]);

      await world.observe();
      await ada.edit(homeVal, ["title"], "Hello from Ada");
      await world.settle();
      await world.observe();

      world.expectInvariants();
      expect(world.frames.last("bo")).toBe("Hello from Ada");
      // Bo learned of it from the poll, and fetched the patch itself.
      expect(
        world.network.log.some(
          (e) =>
            e.from === "studio:bo" &&
            e.method === "GET" &&
            e.path === "/api/val/patches",
        ),
      ).toBe(true);
    });
  },
);
