import {
  Internal,
  initVal,
  type Json,
  type ModuleFilePath,
} from "@valbuild/core";
import { filterBlockingValidationErrors } from "@valbuild/shared/internal";
import { initTestSystem, mfp, sp } from "./testSystem";
import type { ValidationStore } from "./ValidationStore";

/**
 * Validation errors that resolve against ANOTHER module's source.
 *
 * `s.keyOf(record)` and `s.route()` cannot be checked by the schema alone: a
 * core schema emits a `keyof:check-keys` / `router:check-route` marker, and
 * `resolveSchemaSourceFixes` settles it against the referenced record's keys
 * when the errors are read. So whether a module is valid depends on source it
 * does not own — and the store has to know that, or the error a field shows
 * describes a world that no longer exists.
 *
 * Two ways that went wrong, both observed on a real site after asking the AI to
 * rename a page (a record key other modules point at) and then discarding:
 *
 * 1. A discard that emptied a module's chain emitted only `source:patch-drop`,
 *    and nothing invalidated on that event, so the module kept the validation
 *    result computed against the discarded edit.
 * 2. Renaming the key changed nothing in the module HOLDING the reference, so
 *    that module was never invalidated — before the rename was discarded or
 *    after — and its "does not exist" error outlived the rename that caused it.
 */

const PAGES = mfp("/pages.val.ts");
const NAV = mfp("/nav.val.ts");
const NAV_PRIMARY = sp('/nav.val.ts?p="primary"');

const pagesModule = () => {
  const { c, s } = initVal();
  return c.define("/pages.val.ts", s.record(s.string()), {
    "/home": "Home",
    "/about": "About",
  });
};

const navModule = () => {
  const { c, s } = initVal();
  return c.define(
    "/nav.val.ts",
    s.object({ primary: s.keyOf(pagesModule()), heading: s.string() }),
    { primary: "/home", heading: "Main nav" },
  );
};

type Rig = ReturnType<typeof initTestSystem>;

/** The errors a field would show: resolved and filtered like the UI does. */
async function surfaced(rig: Rig, moduleFilePath: ModuleFilePath) {
  const result = await rig.validationStore.validate(moduleFilePath);
  if (result.status !== "validated") {
    throw new Error(`expected a validated result, got ${result.status}`);
  }
  if (result.errors === false) return {};
  const sources: Record<ModuleFilePath, Json> = {};
  for (const loaded of rig.sourceStore.loadedModules()) {
    const source = rig.sourceStore.moduleSource(loaded);
    if (source !== undefined) {
      sources[loaded] = source;
    }
  }
  return filterBlockingValidationErrors(
    result.errors,
    rig.schemaStore.all(),
    sources,
  );
}

async function write(
  rig: Rig,
  moduleFilePath: ModuleFilePath,
  patch: Parameters<Rig["patchStore"]["createPatch"]>[1],
) {
  const record = await rig.patchStore.createPatch(moduleFilePath, patch);
  return record.patchId;
}

function isStale(
  validationStore: ValidationStore,
  moduleFilePath: ModuleFilePath,
) {
  return validationStore.peek(moduleFilePath).status === "stale";
}

describe("a discard reaches validation", () => {
  it("invalidates the module whose whole chain was discarded", async () => {
    const rig = initTestSystem();
    await rig.sourceStore.testReceive([pagesModule(), navModule()]);

    const patchId = await write(rig, NAV, [
      { op: "replace", path: ["primary"], value: "/nowhere" },
    ]);
    const broken = await surfaced(rig, NAV);
    expect(broken[NAV_PRIMARY]?.[0]?.message).toMatch(
      /'\/nowhere' does not exist/,
    );

    // The discard: the server has deleted it, and the store is told so. This
    // was the module's only patch, so its chain is now empty and the source
    // store rebuilds it from base with nothing to re-apply.
    rig.patchStore.drop([patchId]);

    expect(isStale(rig.validationStore, NAV)).toBe(true);
    expect(await surfaced(rig, NAV)).toEqual({});
    rig.dispose();
  });
});

describe("a change to a referenced record's keys reaches the referrer", () => {
  it("invalidates the referrer when the key it points at is renamed", async () => {
    const rig = initTestSystem();
    await rig.sourceStore.testReceive([pagesModule(), navModule()]);
    expect(await surfaced(rig, NAV)).toEqual({});
    const before = rig.validationStore.peek(NAV);

    // The rename lives entirely in the referenced module. Nothing in `nav`
    // changed, so nothing about `nav`'s own source says it is now invalid.
    await write(rig, PAGES, [
      { op: "move", from: ["/home"], path: ["/start"] },
    ]);

    expect(rig.validationStore.peek(NAV)).not.toBe(before);
    expect(isStale(rig.validationStore, NAV)).toBe(true);
    const broken = await surfaced(rig, NAV);
    expect(broken[NAV_PRIMARY]?.[0]?.message).toMatch(
      /'\/home' does not exist/,
    );
    rig.dispose();
  });

  it("clears the referrer's error when the rename is discarded", async () => {
    const rig = initTestSystem();
    await rig.sourceStore.testReceive([pagesModule(), navModule()]);

    const rename = await write(rig, PAGES, [
      { op: "move", from: ["/home"], path: ["/start"] },
    ]);
    const broken = await surfaced(rig, NAV);
    expect(Object.keys(broken)).toEqual([NAV_PRIMARY]);
    const whileRenamed = rig.validationStore.peek(NAV);

    // The user changes their mind. `/home` exists again — and `nav`, which
    // still says `/home`, was never wrong. Its error must go with the rename.
    rig.patchStore.drop([rename]);

    expect(rig.validationStore.peek(NAV)).not.toBe(whileRenamed);
    expect(await surfaced(rig, NAV)).toEqual({});
    rig.dispose();
  });

  it("does not invalidate the referrer for an edit inside an entry", async () => {
    const rig = initTestSystem();
    await rig.sourceStore.testReceive([pagesModule(), navModule()]);
    await surfaced(rig, NAV);
    const before = rig.validationStore.peek(NAV);

    // Typing into a page's content changes the record's VALUES, not its keys,
    // and the keys are all a `keyOf` resolves against. Waking the referrer here
    // would put a second module's validation on every keystroke.
    await write(rig, PAGES, [
      { op: "replace", path: ["/home"], value: "Welcome home" },
    ]);

    expect(rig.validationStore.peek(NAV)).toBe(before);
    rig.dispose();
  });
});

describe("a change to a router module's keys reaches the fields holding routes", () => {
  const ROUTES = mfp("/app/[slug]/page.val.ts");
  const LINKS = mfp("/links.val.ts");
  const LINKS_CTA = sp('/links.val.ts?p="cta"');

  const routesModule = () => {
    const { c, s } = initVal();
    return c.define(
      "/app/[slug]/page.val.ts",
      s.record(s.string()).router(Internal.nextAppRouter),
      { "/home": "Home", "/about": "About" },
    );
  };
  /** `s.route()` names no module: it resolves against EVERY router's keys. */
  const linksModule = () => {
    const { c, s } = initVal();
    return c.define("/links.val.ts", s.object({ cta: s.route() }), {
      cta: "/home",
    });
  };

  it("invalidates the route field's module when the route is renamed", async () => {
    const rig = initTestSystem();
    await rig.sourceStore.testReceive([routesModule(), linksModule()]);
    expect(await surfaced(rig, LINKS)).toEqual({});
    const before = rig.validationStore.peek(LINKS);

    await write(rig, ROUTES, [
      { op: "move", from: ["/home"], path: ["/start"] },
    ]);

    expect(rig.validationStore.peek(LINKS)).not.toBe(before);
    const broken = await surfaced(rig, LINKS);
    expect(broken[LINKS_CTA]?.[0]?.message).toMatch(
      /Route '\/home' does not exist/,
    );
    rig.dispose();
  });

  it("leaves it alone for an edit inside a page", async () => {
    const rig = initTestSystem();
    await rig.sourceStore.testReceive([routesModule(), linksModule()]);
    await surfaced(rig, LINKS);
    const before = rig.validationStore.peek(LINKS);

    // Every page module is a router module, so this is the keystroke case: it
    // must not cost every module with a link a validation.
    await write(rig, ROUTES, [
      { op: "replace", path: ["/home"], value: "Welcome home" },
    ]);

    expect(rig.validationStore.peek(LINKS)).toBe(before);
    rig.dispose();
  });
});

describe("a discard reaches search", () => {
  it("stops finding the discarded text", async () => {
    const rig = initTestSystem();
    await rig.sourceStore.testReceive([pagesModule(), navModule()]);
    await rig.buildSearchIndex();

    const patchId = await write(rig, PAGES, [
      { op: "replace", path: ["/home"], value: "Zebra crossing" },
    ]);
    const found = await rig.search("Zebra");
    if (found.status !== "results") {
      throw new Error("expected search results");
    }
    expect(found.results.length).toBeGreaterThan(0);

    // The module's only patch: the drop is announced, and nothing is re-applied.
    rig.patchStore.drop([patchId]);

    const gone = await rig.search("Zebra");
    if (gone.status !== "results") {
      throw new Error("expected search results");
    }
    expect(gone.results).toEqual([]);
    rig.dispose();
  });
});
