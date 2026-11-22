/** @jest-environment node */
import ts from "typescript";
import path from "path";

/**
 * A project that registers an `.external(label)` module has to hand the server
 * entry points an adapter for that label, and the compiler is what says so.
 *
 * These are the negative cases: `initValServer(valModules, config)` with no
 * `external`, or with a registry that binds only some of the labels. They cannot
 * be written as ordinary tests without `@ts-expect-error`, which this codebase
 * does not allow, so each one typechecks a small project and reads the
 * diagnostics back. The project is the real thing in miniature: its
 * `val/server.ts` calls this package's own `initValServer` and `initValContent`.
 *
 * `packages/next/src/server/externalOption.test.ts` is the same suite over
 * `@valbuild/next`.
 */

const packageDir = path.join(__dirname, "../..");
/** Does not exist on disk: every file in it is one of the strings below. */
const projectDir = path.join(__dirname, "__external_option_project__");
const projectFile = (rel: string) => path.join(projectDir, rel);

const compilerOptions = (() => {
  const configFile = path.join(packageDir, "tsconfig.json");
  const read = ts.readConfigFile(configFile, ts.sys.readFile);
  return ts.parseJsonConfigFileContent(read.config, ts.sys, packageDir).options;
})();

const externalModule = (file: string, label: string) => `
import { s, c } from "../val.config";
export default c.define(
  "/content/${file}",
  s.record(s.object({ title: s.string() })).external("${label}"),
  c.external(),
);
`;

const adapter = `{
  keys: async () => ({ keys: [], cursor: null }),
  get: async () => ({ a: { title: "A" } }),
  put: async () => {},
  delete: async () => {},
}`;

/** Two external modules and an ordinary one, all registered. */
const project: Record<string, string> = {
  "val.config.ts": `
import { initVal } from "@valbuild/core";
export const { s, c, config } = initVal();
`,
  "content/posts.val.ts": externalModule("posts.val.ts", "posts"),
  "content/documents.val.ts": externalModule("documents.val.ts", "documents"),
  "content/page.val.ts": `
import { s, c } from "../val.config";
export default c.define("/content/page.val.ts", s.object({ title: s.string() }), { title: "" });
`,
  "val.modules.ts": `
import { modules } from "@valbuild/core";
import { config } from "./val.config";
export default modules(config, [
  { def: () => import("./content/page.val") },
  { def: () => import("./content/posts.val") },
  { def: () => import("./content/documents.val") },
]);
`,
  "val/external.ts": `
import { defineExternal } from "../../index";
import postsVal from "../content/posts.val";
import documentsVal from "../content/documents.val";
const { entry, modules } = defineExternal();
export const both = modules({
  posts: entry(postsVal, ${adapter}),
  documents: entry(documentsVal, ${adapter}),
});
export const onlyPosts = modules({ posts: entry(postsVal, ${adapter}) });
`,
};

const serverFile = (body: string) => `
import { initValServer, initValContent } from "../../index";
import { config } from "../val.config";
import valModules from "../val.modules";
import { both, onlyPosts } from "./external";
void both;
void onlyPosts;
${body}
`;

let previous: ts.Program | undefined;

/**
 * Typecheck the project with `overrides` laid over it, and return the errors
 * in `val/server.ts`. Every OTHER file of the project has to be clean, or a
 * mistake in the fixture would read as the error a test was looking for.
 */
function errorsIn(overrides: Record<string, string>): string[] {
  const files = new Map(
    Object.entries({ ...project, ...overrides }).map(([rel, content]) => [
      projectFile(rel),
      content,
    ]),
  );
  const host = ts.createCompilerHost(compilerOptions);
  const onDisk = {
    fileExists: host.fileExists,
    readFile: host.readFile,
    getSourceFile: host.getSourceFile,
    directoryExists: host.directoryExists,
  };
  host.fileExists = (fileName) =>
    files.has(fileName) || onDisk.fileExists(fileName);
  host.readFile = (fileName) =>
    files.get(fileName) ?? onDisk.readFile(fileName);
  host.directoryExists = (dir) =>
    dir.startsWith(projectDir) || (onDisk.directoryExists?.(dir) ?? true);
  host.getSourceFile = (fileName, languageVersion, ...rest) => {
    const content = files.get(fileName);
    return content === undefined
      ? onDisk.getSourceFile(fileName, languageVersion, ...rest)
      : ts.createSourceFile(fileName, content, languageVersion);
  };
  const program = ts.createProgram(
    [...files.keys()],
    compilerOptions,
    host,
    previous,
  );
  previous = program;
  const messagesOf = (rel: string) => {
    const sourceFile = program.getSourceFile(projectFile(rel));
    if (sourceFile === undefined) {
      throw new Error(`${rel} is not part of the program`);
    }
    return program
      .getSemanticDiagnostics(sourceFile)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "));
  };
  for (const rel of Object.keys({ ...project, ...overrides })) {
    if (rel !== "val/server.ts") {
      expect({ file: rel, errors: messagesOf(rel) }).toEqual({
        file: rel,
        errors: [],
      });
    }
  }
  return messagesOf("val/server.ts");
}

describe("a project with .external() modules must pass their adapters", () => {
  test("a registry that binds every label is accepted", () => {
    expect(
      errorsIn({
        "val/server.ts": serverFile(`
initValServer(valModules, { ...config, external: both });
initValContent({ ...config, external: both }, valModules);
`),
      }),
    ).toEqual([]);
  });

  test("leaving `external` out is an error at both entry points", () => {
    const errors = errorsIn({
      "val/server.ts": serverFile(`
initValServer(valModules, { ...config });
initValContent(config, valModules);
`),
    });
    expect(errors).toHaveLength(2);
    for (const error of errors) {
      expect(error).toContain("Property 'external' is missing");
      // The message has to say WHICH adapters, or the fix is a guess.
      expect(error).toMatch(/ExternalRecords<"posts" \| "documents">/);
    }
  });

  test("a registry that binds only some labels names the one it lacks", () => {
    const errors = errorsIn({
      "val/server.ts": serverFile(`
initValServer(valModules, { ...config, external: onlyPosts });
initValContent({ ...config, external: onlyPosts }, valModules);
`),
    });
    expect(errors).toHaveLength(2);
    for (const error of errors) {
      expect(error).toContain("Property 'documents' is missing");
    }
  });

  test("a module registered conditionally still needs its adapter", () => {
    const errors = errorsIn({
      "val.modules.ts": `
import { modules } from "@valbuild/core";
import { config } from "./val.config";
declare const withDocuments: boolean;
export default modules(config, [
  { def: () => import("./content/posts.val") },
  ...(withDocuments ? [{ def: () => import("./content/documents.val") }] : []),
]);
`,
      "val/server.ts": serverFile(`
initValServer(valModules, { ...config, external: onlyPosts });
`),
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Property 'documents' is missing");
  });
});

describe("a project that is not checked is asked for nothing", () => {
  test("no .external() modules: `external` stays optional", () => {
    expect(
      errorsIn({
        "val.modules.ts": `
import { modules } from "@valbuild/core";
import { config } from "./val.config";
export default modules(config, [{ def: () => import("./content/page.val") }]);
`,
        "val/server.ts": serverFile(`
initValServer(valModules, { ...config });
initValContent(config, valModules);
`),
      }),
    ).toEqual([]);
  });

  test("a val.modules.ts annotated as plain ValModules opts out", () => {
    // Not a feature so much as the edge of what a type can know: the module
    // types are gone, so there are no labels to read. The server's own startup
    // check is what covers this project, and a JavaScript one.
    expect(
      errorsIn({
        "val.modules.ts": `
import { modules, type ValModules } from "@valbuild/core";
import { config } from "./val.config";
const valModules: ValModules = modules(config, [
  { def: () => import("./content/posts.val") },
]);
export default valModules;
`,
        "val/server.ts": serverFile(`
initValServer(valModules, { ...config });
initValContent(config, valModules);
`),
      }),
    ).toEqual([]);
  });

  test("a registry annotated as plain ExternalRecords opts out too", () => {
    // The same edge from the other side: the annotation erases which labels
    // the registry binds, and the widest registry is accepted where a specific
    // one is asked for. Pinned so that it stays a known hole rather than
    // becoming a surprise in either direction.
    expect(
      errorsIn({
        "val/server.ts": serverFile(`
import type { ExternalRecords } from "../../index";
const erased: ExternalRecords = onlyPosts;
initValServer(valModules, { ...config, external: erased });
`),
      }),
    ).toEqual([]);
  });
});
