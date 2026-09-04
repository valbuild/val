import { computeValModuleShas, extractValModules } from "./extractValModules";
import { initVal } from "./initVal";
import { modules } from "./modules";
import type { ValConfig } from "./initVal";

const { s, c } = initVal();

function valModules(config: ValConfig) {
  return modules(config, [
    {
      def: () =>
        Promise.resolve({
          default: c.define("/content/page.val.ts", s.string(), "hello"),
        }),
    },
    {
      def: () =>
        Promise.resolve({
          default: c.define(
            "/content/other.val.ts",
            s.object({ title: s.string() }),
            { title: "other" },
          ),
        }),
    },
  ]);
}

describe("extractValModules", () => {
  // The server extracts from the Node bundle and the editor SPA from the
  // browser bundle. `gitCommit` / `gitBranch` are documented as
  // `process.env.VERCEL_GIT_COMMIT_SHA` / `_REF`, which are server-only env
  // vars: they are set on the server and `undefined` in the browser. If
  // schemaSha depended on them, the two sides would disagree on every
  // production load and the UI would show "a new version has been deployed"
  // forever.
  test("schemaSha does not depend on the config", async () => {
    const server = await extractValModules(
      valModules({
        project: "team/project",
        gitCommit: "0e3a1f9c5b7d2a4e6f8091b3c5d7e9f1a2b4c6d8",
        gitBranch: "main",
      }),
    );
    const browser = await extractValModules(
      valModules({
        project: "team/project",
        gitCommit: undefined,
        gitBranch: undefined,
      }),
    );

    expect(server.schemaSha).toBe(browser.schemaSha);
    // Sources are config-independent for the same reason.
    expect(server.sourcesSha).toBe(browser.sourcesSha);
    // configSha is still reported separately, and still reflects the config.
    expect(server.configSha).not.toBe(browser.configSha);
  });

  test("schemaSha changes when a schema changes", async () => {
    const config: ValConfig = { project: "team/project" };
    const before = await extractValModules(valModules(config));
    const after = await extractValModules(
      modules(config, [
        {
          def: () =>
            Promise.resolve({
              default: c.define("/content/page.val.ts", s.number(), 1),
            }),
        },
      ]),
    );
    expect(before.schemaSha).not.toBe(after.schemaSha);
  });

  test("schemaSha changes when a module is renamed but its schema is not", async () => {
    // schemaSha hashed the serialized schemas only, so moving a module to a new
    // path left it identical. An open client compares it to decide whether to
    // refetch /schema; with no commitSha to fall back on it kept a schema cache
    // keyed by the path that no longer exists.
    const before = await extractValModules(
      modules({ project: "team/project" }, [
        {
          def: () =>
            Promise.resolve({
              default: c.define("/content/old.val.ts", s.string(), "hello"),
            }),
        },
      ]),
    );
    const after = await extractValModules(
      modules({ project: "team/project" }, [
        {
          def: () =>
            Promise.resolve({
              default: c.define("/content/new.val.ts", s.string(), "hello"),
            }),
        },
      ]),
    );

    expect(after.schemaSha).not.toBe(before.schemaSha);
  });

  test("a module that throws while importing is reported, not thrown", async () => {
    // A rejecting def() used to abort the whole extraction: on the server that
    // means ValOps.initSources rejects and /stat, /schema and /sources/~ all
    // fail opaquely instead of naming the module that is actually broken.
    const extracted = await extractValModules(
      modules({ project: "team/project" }, [
        {
          def: () =>
            Promise.resolve({
              default: c.define("/content/page.val.ts", s.string(), "hello"),
            }),
        },
        { def: () => Promise.reject(new Error("Unexpected token ';'")) },
      ]),
    );

    expect(extracted.moduleErrors).toHaveLength(1);
    expect(extracted.moduleErrors[0].message).toContain("Unexpected token ';'");
    // The modules that did load are still usable.
    expect(Object.keys(extracted.serializedSchemas)).toStrictEqual([
      "/content/page.val.ts",
    ]);
  });

  test("an error thrown from another realm keeps its message", async () => {
    // Val modules are evaluated inside a `node:vm` context, so a genuine
    // TypeError thrown from inside the sandbox is built from THAT realm's Error
    // constructor and fails `instanceof Error`. Reporting it via
    // JSON.stringify flattened it to "{}" - the message, i.e. the only useful
    // part, was thrown away. Simulated here with a cross-realm-shaped value:
    // has a string `message`, is not an `Error`.
    const crossRealmError = {
      name: "TypeError",
      message: "c.defineBROKEN is not a function",
      stack: "TypeError: c.defineBROKEN is not a function\n    at <anonymous>",
    };
    const extracted = await extractValModules(
      modules({ project: "team/project" }, [
        { def: () => Promise.reject(crossRealmError) },
      ]),
    );

    expect(extracted.moduleErrors).toHaveLength(1);
    // The message itself, not a JSON dump of the error object: stringifying it
    // would give `Error: {"name":"TypeError","message":"...","stack":"..."}`.
    expect(extracted.moduleErrors[0].message).toContain(
      "Error: c.defineBROKEN is not a function",
    );
    expect(extracted.moduleErrors[0].message).not.toContain('"stack"');
  });

  test("a thrown value with no message at all still reports something", async () => {
    const extracted = await extractValModules(
      modules({ project: "team/project" }, [
        { def: () => Promise.reject("just a string") },
        { def: () => Promise.reject(undefined) },
      ]),
    );

    expect(extracted.moduleErrors).toHaveLength(2);
    // Unquoted: JSON.stringify would render it as `Error: "just a string"`.
    expect(extracted.moduleErrors[0].message).toContain("Error: just a string");
    // `JSON.stringify(undefined)` is undefined, so this must not interpolate
    // the word "undefined" from a missing return value.
    expect(extracted.moduleErrors[1].message).toContain("at index 1");
  });

  test("moduleErrors is dense so consumers using find() do not crash", async () => {
    const extracted = await extractValModules(
      modules({ project: "team/project" }, [
        // First module is fine, second is broken: an index-keyed error array
        // would leave a hole at index 0 that `Array.prototype.find` visits.
        {
          def: () =>
            Promise.resolve({
              default: c.define("/content/page.val.ts", s.string(), "hello"),
            }),
        },
        {
          def: () => {
            // A module object with no default export. Built as a valid one and
            // then stripped, so producing the malformed shape does not need an
            // `as any` (which CLAUDE.md rules out).
            const mod = {
              default: c.define("/content/other.val.ts", s.string(), "hello"),
            };
            Reflect.deleteProperty(mod, "default");
            return Promise.resolve(mod);
          },
        },
      ]),
    );
    expect(extracted.moduleErrors).toHaveLength(1);
    expect(() =>
      extracted.moduleErrors.find((e) => e.path === "/content/page.val.ts"),
    ).not.toThrow();
  });

  describe("settings modules", () => {
    const settingsDef = (moduleFilePath: string) => ({
      def: () =>
        Promise.resolve({
          default: c.define(moduleFilePath, s.settings(), {}),
        }),
    });

    test("one settings module at the root is not an error", async () => {
      const extracted = await extractValModules(
        modules({}, [settingsDef("/settings.val.ts")]),
      );
      expect(extracted.moduleErrors).toEqual([]);
    });

    test("settings in a subdirectory is a module error", async () => {
      const extracted = await extractValModules(
        modules({}, [settingsDef("/content/settings.val.ts")]),
      );
      expect(extracted.moduleErrors).toHaveLength(1);
      expect(extracted.moduleErrors[0].path).toBe("/content/settings.val.ts");
      expect(extracted.moduleErrors[0].message).toContain("root");
    });

    test("two settings modules is a module error on each", async () => {
      const extracted = await extractValModules(
        modules({}, [
          settingsDef("/settings.val.ts"),
          settingsDef("/config.val.ts"),
        ]),
      );
      expect(extracted.moduleErrors.map((error) => error.path)).toEqual([
        "/config.val.ts",
        "/settings.val.ts",
      ]);
    });

    test("the SHAs stay a function of the modules, not of these errors", async () => {
      // The errors are appended AFTER the fold, so the SHAs are what the same
      // modules would hash to with no errors at all. That is the property the
      // server's source promotion relies on: replaying the entries reproduces
      // the SHAs. Extraction is what reports the rule; the SHAs are for change
      // detection.
      const config = {};
      const extracted = await extractValModules(
        modules(config, [settingsDef("/content/settings.val.ts")]),
      );
      expect(extracted.moduleErrors).toHaveLength(1);
      expect(computeValModuleShas(config, extracted.shaEntries, [])).toEqual({
        baseSha: extracted.baseSha,
        schemaSha: extracted.schemaSha,
        sourcesSha: extracted.sourcesSha,
        configSha: extracted.configSha,
      });
    });
  });
});
