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
 * "A field the assistant added cannot be saved: the editor types, and it goes
 * back to what it was."
 *
 * Reported for code mode, where the assistant changes a `.val.ts` in a
 * proposal. What these scenarios can express today is the same change in
 * LOCAL DEVELOPMENT: the module's code changes, the app's server gets the new
 * registry the way HMR gives it (`world.deployCode`), and the Studio gets it
 * the way `<ValModulesClient>` registers it (`studio.receiveCode`).
 *
 * What they cannot express yet, and so do NOT cover: the hosted proposal
 * (the content version and the proposal's overlay the platform hands its
 * build, `__VAL_BASE__`, BaseAlignment against another build, and stagings
 * recorded by the content service). The analysis in
 * `docs/plans/one-content-model.md` points there for the reported bug, so
 * these passing does not mean the bug is gone.
 */

const { s, c, config } = initVal({});

const before = c.define(
  "/content/home.val.ts",
  s.object({ title: s.string() }),
  { title: "Hello" },
);

// The assistant adds a button to the page's schema, with content for it.
const after = c.define(
  "/content/home.val.ts",
  s.object({ title: s.string(), button: s.object({ label: s.string() }) }),
  { title: "Hello", button: { label: "Buy" } },
);

describe.each(["fs", "memory", "http"] as const)(
  "a field the assistant added, on %s",
  (server) => {
    let world: World | null = null;
    afterEach(async () => {
      await world?.dispose();
      world = null;
    });

    async function start() {
      world = await createWorld({ config, modules: [before], server });
      const studio = await world.studio("editor");
      const page = world.page("/", { draftMode: true });
      return { world, studio, page };
    }

    test("is kept when the server and the Studio have the new code", async () => {
      const { world, studio, page } = await start();
      await world.changeCode([after]);
      await world.settle();

      studio.reads("field", after, ["button", "label"]);
      page.reads(
        "loader",
        async (val) => (await val.fetchVal(after)).button.label,
      );
      await world.observe();

      await studio.edit(after, ["button", "label"], "Buy now");
      await world.settle();
      await world.observe();

      world.expectInvariants();
      expect(world.frames.last("field")).toBe("Buy now");
      expect(world.frames.last("loader")).toBe("Buy now");
      expect(studio.errors()).toEqual([]);
    });

    /**
     * The bug "a field the assistant added reverts", reproduced in local
     * development. It FAILED until phase 9 of the plan, and was marked so.
     *
     * HMR reaches the page and the server in either order. Here the Studio's
     * registry is swapped first, the edit is made, and only then does the
     * server get the new code. What happened, from the request log:
     *
     *   POST /stat           the old server answers with ITS sourcesSha
     *   PUT  /sources/~      BaseAlignment fetches that base: no `button`
     *   PUT  /patches        the edit is saved
     *   DELETE /patches      it cannot be applied on that base (a `replace`
     *                        of a key that is not there), so the Studio deletes
     *                        it: "An edit could not be applied and has been
     *                        discarded."
     *
     * The old server's base was evaluated with a schema without the field,
     * and the Studio read it with one that has it: content read with a
     * schema it was not made for. Now, for a module whose schema new code
     * moved the Studio to and no build has answered with yet, BaseAlignment
     * leaves out a base the answering build evaluated with another schema
     * (`PUT /sources/~` answers each module's version): the Studio keeps the
     * base its own code wrote, the edit applies there at once, and on the
     * server once it has the code.
     *
     * Code mode's save before each code write does not reach this one: HMR is
     * no write through the server. Its hosted form passes as C5 in
     * `codeMode.scenario.test.ts`.
     */
    test("is kept when the Studio has the new code before the server does", async () => {
      const { world, studio, page } = await start();
      await studio.receiveCode([after]);
      studio.reads("field", after, ["button", "label"]);
      await world.observe();

      await studio.edit(after, ["button", "label"], "Buy now");
      await world.settle();
      world.deployCode([after]);
      await world.settle();

      page.reads(
        "loader",
        async (val) => (await val.fetchVal(after)).button.label,
      );
      await world.observe();

      world.expectInvariants();
      expect(world.frames.last("field")).toBe("Buy now");
      expect(world.frames.last("loader")).toBe("Buy now");
      expect(studio.errors()).toEqual([]);
    });
  },
);
