import { initVal, type ModuleFilePath, type ValModules } from "@valbuild/core";
import { createSystem } from "./createSystem";
import { reloadStaged } from "../proposals/stagedCode";

/**
 * After every file the assistant stages, the tab evaluates `val.modules`
 * again and hands the registry to the Studio (`runStagedCode`). Most of
 * those writes touch no `.val.ts`: the registry is the same code again, in
 * new instances. That used to be a new intake all the same -- a new
 * `initializedAt`, which every read hook in the editor re-renders on -- once
 * per write, for a write that changed nothing the Studio shows.
 */

const MODULE = "/home.val.ts" as ModuleFilePath;

/** A registry that is all new instances, as an imported bundle is. */
function registry(fields: string[]): ValModules {
  const { c, s, config } = initVal();
  const module = c.define(
    MODULE,
    s.object(Object.fromEntries(fields.map((field) => [field, s.string()]))),
    Object.fromEntries(fields.map((field) => [field, field])),
  );
  return { config, modules: [{ def: async () => ({ default: module }) }] };
}

/** The clock, so two intakes in the same millisecond are still told apart. */
function withClock() {
  let now = 1_000;
  jest.spyOn(Date, "now").mockImplementation(() => (now += 1_000));
}

afterEach(() => jest.restoreAllMocks());

test("the same code again is not a new intake: nothing that reads the Studio is woken to re-read it", async () => {
  withClock();
  const system = createSystem({ fetchPatches: async () => ({ patches: [] }) });
  const reload = reloadStaged(system.host);
  await reload(registry(["title"]));
  const first = system.host.initializedAt();
  expect(first).not.toBeNull();
  const schema = system.schemaStore.get(MODULE);

  // A write that touched a component: `val.modules` evaluates to the same.
  const again = await reload(registry(["title"]));
  expect(again).toMatchObject({ status: "reloaded", changed: [], removed: [] });
  expect(system.host.initializedAt()).toBe(first);
  expect(system.schemaStore.get(MODULE)).toBe(schema);
});

test("code that moved is a new intake", async () => {
  withClock();
  const system = createSystem({ fetchPatches: async () => ({ patches: [] }) });
  const reload = reloadStaged(system.host);
  await reload(registry(["title"]));
  const first = system.host.initializedAt();

  const moved = await reload(registry(["title", "lead"]));
  expect(moved).toMatchObject({ status: "reloaded", changed: [MODULE] });
  expect(system.host.initializedAt()).not.toBe(first);

  // And a module that leaves is one too.
  const second = system.host.initializedAt();
  const { config } = initVal();
  await reload({ config, modules: [] });
  expect(system.host.initializedAt()).not.toBe(second);
});

test("content that moved under the same schema is a new intake", async () => {
  withClock();
  const system = createSystem({ fetchPatches: async () => ({ patches: [] }) });
  const reload = reloadStaged(system.host);
  await reload(registry(["title"]));
  const first = system.host.initializedAt();

  // The same schema, and the `.val.ts` now says something else.
  const { c, s, config } = initVal();
  const module = c.define(MODULE, s.object({ title: s.string() }), {
    title: "Another title",
  });
  await reload({
    config,
    modules: [{ def: async () => ({ default: module }) }],
  });
  expect(system.host.initializedAt()).not.toBe(first);
  expect(system.host.bundleSources()?.[MODULE]).toEqual({
    title: "Another title",
  });
});

test("a hot reload hands over a new instance of the same schema, and that is a new intake", async () => {
  // Compared by identity there, not by content: an instance carries
  // closures (`validate`, `preview`) the serialized schema does not.
  withClock();
  const system = createSystem({ fetchPatches: async () => ({ patches: [] }) });
  await system.host.reloadCode(registry(["title"]));
  const first = system.host.initializedAt();

  await system.host.reloadCode(registry(["title"]));
  expect(system.host.initializedAt()).not.toBe(first);
});

test("a hot reload that re-evaluated nothing is not one", async () => {
  withClock();
  const system = createSystem({ fetchPatches: async () => ({ patches: [] }) });
  const same = registry(["title"]);
  const { c, s } = initVal();
  const module = c.define(MODULE, s.object({ title: s.string() }), {
    title: "title",
  });
  const kept = {
    ...same,
    modules: [{ def: async () => ({ default: module }) }],
  };
  await system.host.reloadCode(kept);
  await system.host.reloadCode(kept);
  const second = system.host.initializedAt();
  await system.host.reloadCode(kept);
  expect(system.host.initializedAt()).toBe(second);
});
