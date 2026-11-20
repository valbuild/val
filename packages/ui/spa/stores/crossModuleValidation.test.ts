import {
  Internal,
  initVal,
  type Json,
  type ModuleFilePath,
} from "@valbuild/core";
import { filterBlockingValidationErrors } from "@valbuild/shared/internal";
import { initTestSystem, mfp, sp } from "./testSystem";
import type { ValidationStore } from "./ValidationStore";
import { createSystem } from "./createSystem";
import { SchemaValidator } from "../validation/validateModule";
import type { PatchId } from "@valbuild/core";

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

describe("a module joining or leaving the set of routers reaches route fields", () => {
  const LINKS = mfp("/links.val.ts");
  const LINKS_CTA = sp('/links.val.ts?p="cta"');
  const sameKeys = { "/home": "Home", "/about": "About" };

  const asRouter = () => {
    const { c, s } = initVal();
    return c.define(
      "/app/[slug]/page.val.ts",
      s.record(s.string()).router(Internal.nextAppRouter),
      sameKeys,
    );
  };
  const asPlainRecord = () => {
    const { c, s } = initVal();
    return c.define("/app/[slug]/page.val.ts", s.record(s.string()), sameKeys);
  };
  const linksModule = () => {
    const { c, s } = initVal();
    return c.define("/links.val.ts", s.object({ cta: s.route() }), {
      cta: "/home",
    });
  };

  it("invalidates route fields when a record stops being a router", async () => {
    const rig = initTestSystem();
    await rig.sourceStore.testReceive([asRouter(), linksModule()]);
    expect(await surfaced(rig, LINKS)).toEqual({});
    const before = rig.validationStore.peek(LINKS);

    // Same keys, so nothing about the SOURCE moved; the route resolves against
    // routers only, and this record has just left that set.
    // The whole project, as every intake is: one carrying only the changed
    // module now removes the others (S13).
    await rig.sourceStore.testReceive([asPlainRecord(), linksModule()]);

    expect(rig.validationStore.peek(LINKS)).not.toBe(before);
    // With no router left, the resolver reports the route as unverifiable
    // rather than missing; either way the field is no longer clean.
    const broken = await surfaced(rig, LINKS);
    expect(Object.keys(broken)).toEqual([LINKS_CTA]);
    expect(broken[LINKS_CTA]?.[0]?.message).toMatch(/Route '\/home'/);
    rig.dispose();
  });

  it("invalidates route fields when a record becomes a router", async () => {
    const rig = initTestSystem();
    await rig.sourceStore.testReceive([asPlainRecord(), linksModule()]);
    const broken = await surfaced(rig, LINKS);
    expect(Object.keys(broken)).toEqual([LINKS_CTA]);
    const before = rig.validationStore.peek(LINKS);

    // The dependent never saw this module as a router, so no stored keys can
    // register the change; it is the router SET that moved.
    // The whole project, as every intake is: one carrying only the changed
    // module now removes the others (S13).
    await rig.sourceStore.testReceive([asRouter(), linksModule()]);

    expect(rig.validationStore.peek(LINKS)).not.toBe(before);
    expect(await surfaced(rig, LINKS)).toEqual({});
    rig.dispose();
  });
});

describe("a change to a referenced module's schema reaches the referrer", () => {
  it("invalidates the referrer when the referenced module's schema is replaced", async () => {
    const rig = initTestSystem();
    await rig.sourceStore.testReceive([pagesModule(), navModule()]);
    await surfaced(rig, NAV);
    const before = rig.validationStore.peek(NAV);

    // The referenced module arrives again — an HMR round, a reload. Its keys
    // are the same, so a key comparison sees nothing; its schema is what a
    // resolution reads the record's type from, and that is now a new object.
    // The whole project, as every intake is: one carrying only the changed
    // module now removes the others (S13).
    await rig.sourceStore.testReceive([pagesModule(), navModule()]);

    expect(rig.validationStore.peek(NAV)).not.toBe(before);
    expect(await surfaced(rig, NAV)).toEqual({});
    rig.dispose();
  });
});

/**
 * The three tests above re-intake the WHOLE project since S13 (an intake now
 * replaces), so the module they check is received again too, and they no
 * longer prove that the change in the OTHER module is what invalidated it.
 * These do: the referrer is handed over as the very same object, and only the
 * referenced module is new.
 */
describe("a full intake: the referrer is invalidated by what it depends on, not by being received", () => {
  /**
   * The control. Nothing changed: the same module objects again. The
   * referrer's validation result should be kept, because nothing it depends
   * on moved.
   *
   * X1, fixed: `SchemaStore.receive` and `SourceStore.receive` bumped EVERY
   * module an intake carries, changed or not, so every intake invalidated
   * every module -- and the two tests below could not tell the dependency
   * path from the referrer's own re-intake, which is why this control
   * exists. Both now compare what they are handed with what they were
   * handed, and `HostStore` hands back the same objects for a module whose
   * instance did not change.
   */
  it("keeps the referrer's result when nothing changed", async () => {
    const rig = initTestSystem();
    const pages = pagesModule();
    const nav = navModule();
    await rig.sourceStore.testReceive([pages, nav]);
    await surfaced(rig, NAV);
    const before = rig.validationStore.peek(NAV);

    await rig.sourceStore.testReceive([pages, nav]);

    expect(rig.validationStore.peek(NAV)).toBe(before);
    rig.dispose();
  });

  it("invalidates the unchanged referrer when the referenced module is new", async () => {
    const rig = initTestSystem();
    const nav = navModule();
    await rig.sourceStore.testReceive([pagesModule(), nav]);
    await surfaced(rig, NAV);
    const before = rig.validationStore.peek(NAV);

    // Only the referenced module is new (an HMR round of pages.val.ts); the
    // referrer is the same object.
    await rig.sourceStore.testReceive([pagesModule(), nav]);

    expect(rig.validationStore.peek(NAV)).not.toBe(before);
    expect(await surfaced(rig, NAV)).toEqual({});
    rig.dispose();
  });

  it("recomputes the unchanged referrer against the referenced module's new content", async () => {
    const rig = initTestSystem();
    const nav = navModule();
    await rig.sourceStore.testReceive([pagesModule(), nav]);
    expect(await surfaced(rig, NAV)).toEqual({});

    // pages.val.ts changes in code and loses "/home", which nav points at.
    const { c, s } = initVal();
    const pagesWithoutHome = c.define("/pages.val.ts", s.record(s.string()), {
      "/about": "About",
    });
    await rig.sourceStore.testReceive([pagesWithoutHome, nav]);

    const errors = await surfaced(rig, NAV);
    expect(Object.keys(errors)).toEqual([NAV_PRIMARY]);
    rig.dispose();
  });
});

describe("a discard reaches previews", () => {
  const CARD = mfp("/card.val.ts");
  const cardModule = () => {
    const { c, s } = initVal();
    return c.define(
      "/card.val.ts",
      s.array(
        s.object({ title: s.string() }).preview(({ val }) => ({
          title: val.title,
        })),
      ),
      [{ title: "Home" }],
    );
  };

  it("recomputes the preview of a module whose only patch was discarded", async () => {
    const rig = initTestSystem();
    await rig.sourceStore.testReceive([cardModule()]);

    const patchId = await write(rig, CARD, [
      { op: "replace", path: ["0", "title"], value: "Zebra crossing" },
    ]);
    const edited = await rig.previewStore.get(sp("/card.val.ts?p=0"));
    expect(edited.status).toBe("previewed");
    expect(JSON.stringify(edited)).toContain("Zebra crossing");

    rig.patchStore.drop([patchId]);

    // Stale, so the next read recomputes — and recomputes to the base value.
    expect(rig.previewStore.peek(sp("/card.val.ts?p=0")).status).not.toBe(
      "previewed",
    );
    const reverted = await rig.previewStore.get(sp("/card.val.ts?p=0"));
    expect(JSON.stringify(reverted)).not.toContain("Zebra crossing");
    expect(JSON.stringify(reverted)).toContain("Home");
    rig.dispose();
  });
});

describe("a discard reaches references", () => {
  it("stops reporting a reference the discarded patch made", async () => {
    const rig = initTestSystem();
    await rig.sourceStore.testReceive([pagesModule(), navModule()]);

    const patchId = await write(rig, NAV, [
      { op: "replace", path: ["primary"], value: "/about" },
    ]);
    const pointing = await rig.findReferences({
      kind: "keyOf",
      module: PAGES,
      value: "/about",
    });
    expect(pointing.refs).toEqual([NAV_PRIMARY]);

    rig.patchStore.drop([patchId]);

    const after = await rig.findReferences({
      kind: "keyOf",
      module: PAGES,
      value: "/about",
    });
    expect(after.refs).toEqual([]);
    const restored = await rig.findReferences({
      kind: "keyOf",
      module: PAGES,
      value: "/home",
    });
    expect(restored.refs).toEqual([NAV_PRIMARY]);
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

describe("a referenced record moving under a validation in flight", () => {
  /**
   * A system whose validation bridge can be held open, so a change can land
   * while a validation is away — the window in which the dependent has no
   * `resolvedAgainst` entry yet and cannot be found by name.
   */
  function gatedSystem() {
    const validator = new SchemaValidator();
    let release: () => void = () => {};
    let gate: Promise<void> = Promise.resolve();
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
      createPatchId: (() => {
        let next = 0;
        return (): PatchId => `p${++next}` as PatchId;
      })(),
      savePatches: async ({ patches, parentRef }) => ({
        status: "saved",
        newPatchIds: patches.map((patch) => patch.patchId),
        parentRef,
      }),
      publishPatches: async () => ({ status: "published" }),
      discardPatches: async (patchIds) => ({ status: "discarded", patchIds }),
      schemaValidation: {
        async validate(moduleFilePath, source, serializedSchema, version) {
          await gate;
          return validator.validate(
            moduleFilePath,
            source,
            serializedSchema,
            version,
          );
        },
      },
    });
    system.host.receive([pagesModule(), navModule()]);
    system.stat.receiveStat({ patches: [], baseSha: "sha" });
    return {
      system,
      hold() {
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      release() {
        release();
      },
    };
  }

  it("recomputes a first pass that a referenced record moved under", async () => {
    const { system, hold, release } = gatedSystem();

    hold();
    const pending = system.validationStore.validate(NAV);
    // The rename lands while `nav`'s FIRST validation is away. Nothing yet
    // records that `nav` reads `pages`, so this cannot invalidate `nav` by
    // name — it can only move the generation.
    const res = await system.patchStore.createPatch(PAGES, [
      { op: "move", from: ["/home"], path: ["/start"] },
    ]);
    if (res.status !== "created") {
      throw new Error(`createPatch failed: ${res.status}`);
    }
    release();
    const result = await pending;

    // Answered about the world as it is now, and cached as current.
    expect(result.status).toBe("validated");
    expect(system.validationStore.peek(NAV).status).toBe("validated");
    if (result.status !== "validated" || result.errors === false) {
      throw new Error("expected errors to resolve");
    }
    const broken = filterBlockingValidationErrors(
      result.errors,
      system.schemaStore.all(),
      system.sourceStore.allSources(),
    );
    expect(broken[NAV_PRIMARY]?.[0]?.message).toMatch(
      /'\/home' does not exist/,
    );

    // And its inputs are the RENAMED keys: discarding the rename is a key
    // change, so it reaches `nav`. Inputs read before the rename would call
    // the discard a no-op and leave the error standing.
    system.patchStore.drop([res.record.patchId]);
    expect(system.validationStore.peek(NAV).status).toBe("stale");
  });
});

describe("a change to the project's languages reaches locale fields", () => {
  const SETTINGS = mfp("/settings.val.ts");
  const POSTS = mfp("/posts.val.ts");
  const POSTS_LOCALE = sp('/posts.val.ts?p="locale"');

  /**
   * `s.locale()` names no module either: it resolves against
   * `locales.available` in the settings module, which is why a project that
   * has not declared its languages yet is the case that has to keep working.
   */
  const settingsModule = (available: string[]) => {
    const { c, s } = initVal();
    return c.define("/settings.val.ts", s.settings(), {
      locales: { available },
      assistant: { enabled: true },
    });
  };

  const postsModule = () => {
    const { c, s } = initVal();
    return c.define(
      "/posts.val.ts",
      s.object({ locale: s.locale(), title: s.string() }),
      { locale: "nb-NO", title: "Vinterjakka er her" },
    );
  };

  it("clears the error when the language is added to settings", async () => {
    const rig = initTestSystem();
    await rig.sourceStore.testReceive([
      settingsModule(["en-US"]),
      postsModule(),
    ]);

    const broken = await surfaced(rig, POSTS);
    expect(broken[POSTS_LOCALE]?.[0]?.message).toMatch(
      /'nb-NO' is not one of this project's languages/,
    );
    const before = rig.validationStore.peek(POSTS);

    await write(rig, SETTINGS, [
      { op: "add", path: ["locales", "available", "-"], value: "nb-NO" },
    ]);

    expect(rig.validationStore.peek(POSTS)).not.toBe(before);
    expect(await surfaced(rig, POSTS)).toEqual({});
    rig.dispose();
  });

  it("leaves it alone for a settings edit that is not the language list", async () => {
    const rig = initTestSystem();
    await rig.sourceStore.testReceive([
      settingsModule(["en-US", "nb-NO"]),
      postsModule(),
    ]);
    expect(await surfaced(rig, POSTS)).toEqual({});
    const before = rig.validationStore.peek(POSTS);

    // The Settings panel writes here on every keystroke in the assistant's
    // context box. None of it can move what `s.locale()` resolves against.
    await write(rig, SETTINGS, [
      { op: "replace", path: ["assistant", "enabled"], value: false },
    ]);

    expect(rig.validationStore.peek(POSTS)).toBe(before);
    rig.dispose();
  });
});
