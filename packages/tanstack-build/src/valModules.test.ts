import { execFileSync } from "child_process";
import path from "path";

/**
 * `bundleValModules`: a project's Val modules as one ES module whose npm
 * imports are the site's vendor chunks -- imported and read, as the builder
 * tab reads them (step 8.2 of valbuild/home `docs/hosted-publishing.md`).
 * Run in a child process, as the other rolldown tests here are: see the probe.
 */

type Probe =
  | {
      modules: Record<string, { schema: string; source: unknown }>;
      external: boolean;
    }
  | { error: string };

function probe(files: Record<string, string>): Probe {
  const out = execFileSync(
    path.join(__dirname, "..", "node_modules", ".bin", "tsx"),
    [
      path.join(__dirname, "__fixtures__", "valModulesProbe.ts"),
      JSON.stringify(files),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const line = out
    .trim()
    .split("\n")
    .reverse()
    .find((l) => l.startsWith("{"));
  return JSON.parse(line!) as Probe;
}

const project = (extra: Record<string, string> = {}) => ({
  "tsconfig.json": JSON.stringify({
    compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
  }),
  "val.config.ts": [
    `import { initVal } from "@valbuild/core";`,
    `export const { s, c, config } = initVal();`,
  ].join("\n"),
  "val.modules.ts": [
    `import { modules } from "@valbuild/core";`,
    `import { config } from "./val.config";`,
    `export default modules(config, [`,
    `  { def: () => import("./src/home.val") },`,
    `  { def: () => import("./src/notes.val") },`,
    `]);`,
  ].join("\n"),
  "src/home.val.ts": [
    `import { s, c } from "../val.config";`,
    `import { TITLE } from "@/shared";`,
    `export default c.define("/src/home.val.ts", s.object({ title: s.string() }), { title: TITLE });`,
  ].join("\n"),
  "src/shared.ts": `export const TITLE: string = "Sale";`,
  "src/notes.val.ts": [
    `import { s, c } from "../val.config";`,
    `export default c.define("/src/notes.val.ts", s.record(s.object({ text: s.string() })).jsonValues(), {`,
    `  a: c.json(() => import("./notes/a.val.json")),`,
    `});`,
  ].join("\n"),
  "src/notes/a.val.json": JSON.stringify({ text: "First" }),
  ...extra,
});

describe("bundleValModules", () => {
  test("every module, read from one module that imports the site's own @valbuild/core", () => {
    expect(probe(project())).toEqual({
      external: true,
      modules: {
        "/src/home.val.ts": { schema: "object", source: { title: "Sale" } },
        "/src/notes.val.ts": {
          schema: "record",
          source: { a: { text: "First" } },
        },
      },
    });
  });

  test("an npm package the site's layer does not have is named", () => {
    const answer = probe(
      project({
        "src/shared.ts": `import slugify from "slugify";\nexport const TITLE: string = slugify("Sale");`,
      }),
    );
    expect(answer).toEqual({
      error: expect.stringContaining(
        "'slugify' is not an available dependency",
      ),
    });
  });

  test("a project without val.modules.ts says so", () => {
    const { "val.modules.ts": _gone, ...rest } = project();
    expect(probe(rest)).toEqual({
      error: expect.stringContaining("no val.modules.ts"),
    });
  });
});
