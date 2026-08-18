import { extractValModules } from "./extractValModules";
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { def: () => Promise.resolve({ default: undefined as any }) },
      ]),
    );
    expect(extracted.moduleErrors).toHaveLength(1);
    expect(() =>
      extracted.moduleErrors.find((e) => e.path === "/content/page.val.ts"),
    ).not.toThrow();
  });
});
