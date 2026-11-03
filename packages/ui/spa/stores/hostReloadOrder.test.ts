import { initVal, type ModuleFilePath, type ValModules } from "@valbuild/core";
import { createSystem } from "./createSystem";

/**
 * Registries handed to `HostStore.reloadCode` are read in parallel and
 * adopted in order: an older one that took longer to import must not land
 * over a newer one. But only a newer one that was ADOPTED supersedes it --
 * one refused (another Val, not the manifest's, did not load) moved nothing,
 * and the older, good registry was dropped for it.
 */

const MODULE = "/home.val.ts" as ModuleFilePath;

function registry(fields: string[]): ValModules {
  const { c, s, config } = initVal();
  const module = c.define(
    MODULE,
    s.object(Object.fromEntries(fields.map((field) => [field, s.string()]))),
    Object.fromEntries(fields.map((field) => [field, field])),
  );
  return { config, modules: [{ def: async () => ({ default: module }) }] };
}

function setup() {
  const system = createSystem({ fetchPatches: async () => ({ patches: [] }) });
  system.host.receive([]);
  let release: () => void = () => {};
  const slow = (modules: ValModules) => () =>
    new Promise<ValModules>((resolve) => {
      release = () => resolve(modules);
    });
  return {
    system,
    slow,
    release: () => release(),
    fields: () => {
      const schema = system.schemaStore.get(MODULE);
      return schema?.type === "object" ? Object.keys(schema.items) : null;
    },
  };
}

test("a newer registry from another Val does not supersede one still loading", async () => {
  const { system, slow, release, fields } = setup();
  const loading = system.host.reloadCode(slow(registry(["title"])));

  const refused = await system.host.reloadCode(registry(["other"]), {
    expected: { core: "0.0.0-another", modules: {} },
  });
  release();

  expect(refused).toMatchObject({ reason: "other-val-version" });
  expect(await loading).toMatchObject({ status: "reloaded" });
  expect(fields()).toEqual(["title"]);
});

test("a newer registry that does not load does not supersede one still loading", async () => {
  const { system, slow, release, fields } = setup();
  const loading = system.host.reloadCode(slow(registry(["title"])));

  const failed = await system.host.reloadCode(() =>
    Promise.reject(new Error("404")),
  );
  release();

  expect(failed).toMatchObject({ reason: "does-not-load" });
  expect(await loading).toMatchObject({ status: "reloaded" });
  expect(fields()).toEqual(["title"]);
});

test("a newer registry that was adopted still supersedes an older one", async () => {
  const { system, slow, release, fields } = setup();
  const loading = system.host.reloadCode(slow(registry(["old"])));

  await system.host.reloadCode(registry(["new"]));
  release();

  expect(await loading).toMatchObject({ status: "kept", reason: "superseded" });
  expect(fields()).toEqual(["new"]);
});
