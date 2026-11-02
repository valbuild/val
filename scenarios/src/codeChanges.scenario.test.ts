import { initVal, type ValModules } from "@valbuild/core";
import {
  createWorld,
  moduleFilePathOf,
  type ServerMode,
  type World,
} from "./world/createWorld";

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
 * Code changes while the Studio runs. Catalogue ids S11, S12, S13, S14, S16.
 * (S15, another Val version, is not built: one process runs one Val.)
 *
 * A code change here is local development's: the server gets the new
 * registry the way HMR gives it (`world.deployCode`), the Studio the way
 * `<ValModulesClient>` registers it (`studio.receiveCode`).
 */

const { s, c, config } = initVal({});
const PATH = "/content/home.val.ts";
const home = c.define(
  PATH,
  s.object({ title: s.string(), subtitle: s.string() }),
  { title: "Hello", subtitle: "Sub" },
);
/** A field added. */
const homeWithCta = c.define(
  PATH,
  s.object({ title: s.string(), subtitle: s.string(), cta: s.string() }),
  { title: "Hello", subtitle: "Sub", cta: "Buy" },
);
/** `title` renamed to `heading`. */
const homeRenamed = c.define(
  PATH,
  s.object({ heading: s.string(), subtitle: s.string() }),
  { heading: "Hello", subtitle: "Sub" },
);
const footer = c.define(
  "/content/footer.val.ts",
  s.object({ text: s.string() }),
  { text: "Footer" },
);

describe.each<ServerMode>(["memory", "fs", "http"])("on %s", (server) => {
  let world: World | null = null;
  afterEach(async () => {
    await world?.dispose();
    world = null;
  });

  /**
   * S11 A schema change while the page shows an edit.
   *
   * Given a pending edit to the title, shown on a draft page,
   * when the code adds a field to the module (server and Studio both get it),
   * then the edit is still shown by the Studio and the page, nothing is
   * discarded, nothing is read with the old schema, and only that module's
   * version moves: its `schema` and `base`, never another module's, and
   * never its chain (the edit is the same edit).
   *
   * "Only that module is REFETCHED" is the Studio loading by version, which
   * is phase 7; what phase 1 can say is that only that module's version
   * moved, which is what a refetch will key on.
   */
  test("S11 a schema change while the page shows an edit", async () => {
    world = await createWorld({ config, modules: [home, footer], server });
    const editor = await world.studio("editor");
    editor.reads("field", home, ["title"]);
    const page = world.page("/", { draftMode: true });
    page.reads(
      "loader",
      async (val) => (await val.fetchVal(homeWithCta)).title,
    );
    await editor.edit(home, ["title"], "Edited");
    await world.settle();
    const before = await world.manifest();

    await world.changeCode([homeWithCta, footer]);
    await world.settle();
    await world.observe();

    expect(world.frames.last("field")).toBe("Edited");
    expect(world.frames.last("loader")).toBe("Edited");
    expect(editor.errors()).toEqual([]);
    expect(world.network.log.filter((e) => e.method === "DELETE")).toEqual([]);
    // Never read with another schema; and both at the new one, as the server is.
    world.expectInvariants();
    const after = await world.manifest();
    const homePath = moduleFilePathOf(home);
    const footerPath = moduleFilePathOf(footer);
    expect(after.modules[footerPath]).toEqual(before.modules[footerPath]);
    expect(after.modules[homePath]?.schema).not.toBe(
      before.modules[homePath]?.schema,
    );
    expect(after.modules[homePath]?.chain).toBe(
      before.modules[homePath]?.chain,
    );
    for (const surface of ["field", "loader"]) {
      expect(world.frames.lastVersion(surface, homePath)).toEqual(
        after.modules[homePath],
      );
    }
  });

  /**
   * S11 (versions) A new build is counted.
   *
   * Given a server answering at some `seq`, with an edit pending,
   * when a new build replaces it (local development's HMR here),
   * then its answers name the new build and order after the old one's: `seq`
   * moved, with no write in between ("bumped by every write, delete, publish
   * and new build", `ProjectVersion`).
   *
   * fs and memory count a new build themselves (once, under the patch lock
   * in fs). On http `seq` is the content service's `headVersion`, which a
   * new build does not move by itself: the platform (or GitHub) reports the
   * build live, and the service moves the branch's chain version once for it
   * (valbuild/home, `patches.countDeploymentLive`; here the mock content
   * host, told by the world as the platform would tell it). It was
   * `test.failing` on http until the service did.
   */
  test("S11 a new build is counted: its answers order after the last build's", async () => {
    world = await createWorld({ config, modules: [home, footer], server });
    const editor = await world.studio("editor");
    // An edit, so fs mode has a `.val` to count in: a read never makes one.
    await editor.edit(home, ["title"], "Edited");
    await world.settle();
    const before = await world.manifest();

    await world.changeCode([homeWithCta, footer]);
    await world.settle();

    const after = await world.manifest();
    expect(after.project.build).not.toBe(before.project.build);
    expect(after.project.seq).toBeGreaterThan(before.project.seq);
  });

  /**
   * S12 A module whose code throws, after a change, leaves the Studio running
   * and says so.
   *
   * Given a Studio on two modules,
   * when a new registry arrives in which one module's code throws,
   * then the Studio keeps that module (on its old schema) and shows an error
   * naming it.
   *
   * It was skipped: the module was kept only because `SchemaStore.receive`
   * merged (S13), and nothing told the editor, because `loadValModules`
   * dropped a module whose `def` rejected, silently. Now the rejection keeps
   * its place in the list, `HostStore.receive` keeps the module that was
   * there, and the editor is told which one, with what it threw.
   */
  test("S12 a module whose code throws is reported, and the Studio keeps running", async () => {
    world = await createWorld({ config, modules: [home, footer], server });
    const editor = await world.studio("editor");
    await editor.receiveRegistry(registryWithThrowingFooter());
    expect(Object.keys(editor.system.schemaStore.all())).toContain(
      "/content/footer.val.ts",
    );
    expect(editor.errors().join("\n")).toContain("/content/footer.val.ts");
  });

  /**
   * S13 A removed module disappears from the Studio.
   *
   * Given a Studio showing two modules,
   * when the code removes one from val.modules,
   * then the Studio no longer has it.
   *
   * It was skipped: `SchemaStore.receive` merged, so a removed module stayed
   * until a reload. An intake now replaces: the module goes, with its source,
   * validation and previews.
   */
  test("S13 a removed module disappears from the Studio", async () => {
    world = await createWorld({ config, modules: [home, footer], server });
    const editor = await world.studio("editor");
    await world.changeCode([home]);
    expect(Object.keys(editor.system.schemaStore.all())).not.toContain(
      "/content/footer.val.ts",
    );
  });

  /**
   * S14 Edits that no longer fit a new schema are kept, not deleted.
   *
   * Given an unsaved... (saved, pending) edit to the title,
   * when the code renames the title to `heading`,
   * then the edit is held and shown, not discarded.
   *
   * SKIPPED: the Studio cannot apply the edit on the new base (no `title`),
   * so it deletes it, on the server too, and tells the editor "could not be
   * applied and has been discarded". Pinned below. Plan: phase 9 ("edits
   * that no longer fit are held, not deleted").
   */
  test.skip("S14 edits that no longer fit a new schema are kept", async () => {
    world = await createWorld({ config, modules: [home], server });
    const editor = await world.studio("editor");
    await editor.edit(home, ["title"], "Edited");
    await world.settle();
    await world.changeCode([homeRenamed]);
    await world.settle();
    expect(world.network.log.filter((e) => e.method === "DELETE")).toEqual([]);
    expect(editor.system.patchStore.allRecords()).toHaveLength(1);
  });

  test("S14 why: an edit that no longer applies is deleted, on the server too", async () => {
    world = await createWorld({ config, modules: [home], server });
    const editor = await world.studio("editor");
    await editor.edit(home, ["title"], "Edited");
    await world.settle();
    await world.changeCode([homeRenamed]);
    await world.settle();
    expect(world.network.log.filter((e) => e.method === "DELETE")).toHaveLength(
      1,
    );
    expect(editor.system.patchStore.allRecords()).toHaveLength(0);
    expect(editor.errors().join("\n")).toMatch(/could not be applied/);
  });

  /**
   * S16 A schema change the Studio has not got never stops the editor.
   *
   * Given a Studio, and a server that gets new code the Studio does not
   * (a deploy, hosted: no HMR reaches the open tab),
   * when the Studio's poll reaches the new server,
   * then nothing stops the editor: no schema dialog.
   *
   * SKIPPED: today it is BY DESIGN that the Studio reports "out-of-date"
   * (`SchemaFreshnessWatch`, after a 3 s grace and a fresh read), which shows
   * the one-way reload dialog. The plan deletes the dialog (phase 9,
   * `reloadCode`), and this is the test that will say so. Pinned below.
   */
  test.skip("S16 no schema dialog after a deploy the Studio has not got", async () => {
    world = await createWorld({ config, modules: [home], server });
    const editor = await world.studio("editor");
    await deployAndWaitOutTheGrace(world);
    expect(editor.system.status.current().schema).toBe("current");
  });

  // Not on http, for the reason in `overlayAfterBuild`'s "why it flickers":
  // a hosted Studio hears of a deploy through the socket, and the world's
  // `deployCode` tells it only that the build went live, never that one was
  // building.
  (server === "http" ? test.skip : test)(
    "S16 why: SchemaFreshnessWatch reports the schema out of date",
    async () => {
      world = await createWorld({ config, modules: [home], server });
      const editor = await world.studio("editor");
      expect(editor.system.status.current().schema).toBe("current");
      await deployAndWaitOutTheGrace(world);
      expect(editor.system.status.current().schema).toBe("out-of-date");
    },
  );
});

function registryWithThrowingFooter(): ValModules {
  return {
    config,
    modules: [
      { def: () => Promise.resolve({ default: home }) },
      { def: () => Promise.reject(new Error("footer.val.ts threw")) },
    ],
  };
}

/** A deploy the Studio does not get, then past the poll and the watch's grace. */
async function deployAndWaitOutTheGrace(world: World) {
  world.deployCode([homeWithCta]);
  // The poll parked on the old server runs out; the next reaches the new one.
  await world.clock.advance(21_000);
  await world.settle();
  // `SCHEMA_DISAGREEMENT_GRACE_MS`, then the fresh read.
  await world.clock.advance(4_000);
  await world.settle();
}
