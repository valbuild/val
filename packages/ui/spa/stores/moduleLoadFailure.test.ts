import { initVal, type ValModules } from "@valbuild/core";
import { createSystem } from "./createSystem";
import { loadValModules } from "./react/loadValModules";
import { mfp } from "./testSystem";

/**
 * A module whose code throws, mid-edit.
 *
 * `loadValModules` used to leave a rejected `def` out of the list, so the
 * module silently left the Studio -- kept on screen only by an accident of
 * `SchemaStore.receive` merging -- and nobody was told. A registry entry is an
 * `import()` and nothing else, so the module's PLACE in the list is what names
 * it, and what intake keeps it by.
 */
const { s, c, config } = initVal();
const home = c.define("/home.val.ts", s.object({ title: s.string() }), {
  title: "Hello",
});
const footer = c.define("/footer.val.ts", s.object({ text: s.string() }), {
  text: "Footer",
});

const registry = (
  ...defs: ValModules["modules"][number]["def"][]
): ValModules => ({ config, modules: defs.map((def) => ({ def })) });
const ok = (module: typeof home | typeof footer) => () =>
  Promise.resolve({ default: module });
const throws = () => Promise.reject(new Error("footer.val.ts threw"));

describe("a module whose code throws", () => {
  it("is kept as it was, on the schema it last had", async () => {
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
    });
    system.host.receive(await loadValModules(registry(ok(home), ok(footer))));

    system.host.receive(await loadValModules(registry(ok(home), throws)));

    expect(Object.keys(system.schemaStore.all()).sort()).toEqual([
      "/footer.val.ts",
      "/home.val.ts",
    ]);
    expect(system.host.failures()).toEqual([
      {
        moduleFilePath: "/footer.val.ts",
        message: "footer.val.ts threw",
        kept: true,
      },
    ]);
    system.dispose();
  });

  it("tells the editor which module, with what it threw under Details", async () => {
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
    });
    system.host.receive(await loadValModules(registry(ok(home), ok(footer))));

    system.host.receive(await loadValModules(registry(ok(home), throws)));

    const errors = system.status.current().errors;
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("/footer.val.ts");
    expect(errors[0].details).toBe("footer.val.ts threw");
    system.dispose();
  });

  it("takes the message back once the code loads again", async () => {
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
    });
    system.host.receive(await loadValModules(registry(ok(home), ok(footer))));
    system.host.receive(await loadValModules(registry(ok(home), throws)));

    system.host.receive(await loadValModules(registry(ok(home), ok(footer))));

    expect(system.status.current().errors).toEqual([]);
    expect(system.host.failures()).toEqual([]);
    system.dispose();
  });

  it("is named by its place when it has never loaded", async () => {
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
    });

    system.host.receive(await loadValModules(registry(ok(home), throws)));

    expect(system.host.failures()).toEqual([
      {
        moduleFilePath: null,
        message:
          "Module number 2 in val.modules could not be loaded: footer.val.ts threw",
      },
    ]);
    expect(Object.keys(system.schemaStore.all())).toEqual(["/home.val.ts"]);
    system.dispose();
  });
});

/**
 * A module removed from `val.modules` leaves the Studio.
 *
 * `SchemaStore.receive` merged, so it stayed -- in the nav, validated,
 * previewed -- until a reload.
 */
describe("a module removed from val.modules", () => {
  it("goes, with its source", async () => {
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
    });
    system.host.receive(await loadValModules(registry(ok(home), ok(footer))));

    system.host.receive(await loadValModules(registry(ok(home))));

    expect(Object.keys(system.schemaStore.all())).toEqual(["/home.val.ts"]);
    expect(system.sourceStore.moduleSource(mfp("/footer.val.ts"))).toBe(
      undefined,
    );
    expect(system.host.failures()).toEqual([]);
    system.dispose();
  });

  it("comes back when it is added again", async () => {
    const system = createSystem({
      fetchPatches: async () => ({ patches: [] }),
    });
    system.host.receive(await loadValModules(registry(ok(home), ok(footer))));
    system.host.receive(await loadValModules(registry(ok(home))));

    system.host.receive(await loadValModules(registry(ok(home), ok(footer))));

    expect(Object.keys(system.schemaStore.all()).sort()).toEqual([
      "/footer.val.ts",
      "/home.val.ts",
    ]);
    expect(system.sourceStore.moduleSource(mfp("/footer.val.ts"))).toEqual({
      text: "Footer",
    });
    system.dispose();
  });
});
