import { initVal, type ValModules } from "@valbuild/core";
import { createSystem } from "./createSystem";
import { mfp } from "./testSystem";

/**
 * A module new code removed from `val.modules` leaves the search index and
 * the reference index with it.
 *
 * Both are brought up to date by a pass over the modules marked stale, and
 * a pass only walks LOADED modules -- which a removed one no longer is. So
 * its documents stayed: still found, and a hit navigated to a module that
 * is not there; its references still counted, blocking a delete for a
 * referrer that does not exist.
 */
const { c, s, config } = initVal();
const pages = c.define("/pages.val.ts", s.record(s.string()), {
  "/home": "Home",
});
const nav = c.define(
  "/nav.val.ts",
  s.object({ link: s.keyOf(pages), heading: s.string() }),
  { link: "/home", heading: "Zebra crossing" },
);

const registry = (...modules: (typeof pages | typeof nav)[]): ValModules => ({
  config,
  modules: modules.map((module) => ({
    def: async () => ({ default: module }),
  })),
});

function setup() {
  return createSystem({ fetchPatches: async () => ({ patches: [] }) });
}

test("a removed module is not found by search any more", async () => {
  const system = setup();
  await system.host.reloadCode(registry(pages, nav));
  const before = await system.search("zebra");
  expect(before.status === "results" && before.total).toBe(1);

  await system.host.reloadCode(registry(pages));

  const after = await system.search("zebra");
  expect(after.status === "results" && after.results).toEqual([]);
  system.dispose();
});

test("a removed module's references are not counted any more", async () => {
  const system = setup();
  await system.host.reloadCode(registry(pages, nav));
  const before = await system.findReferences({
    kind: "keyOf",
    module: mfp("/pages.val.ts"),
  });
  expect(before.refs).toEqual(['/nav.val.ts?p="link"']);

  await system.host.reloadCode(registry(pages));

  const after = await system.findReferences({
    kind: "keyOf",
    module: mfp("/pages.val.ts"),
  });
  expect(after.refs).toEqual([]);
  system.dispose();
});
