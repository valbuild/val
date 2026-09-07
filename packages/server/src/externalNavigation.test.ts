import ts from "typescript";
import path from "path";
import fs from "fs";

/**
 * The guard for a property nothing else can check: that a developer can NAVIGATE
 * between a schema field, the adapter that produces it, and the page that reads
 * it.
 *
 * Three hops make external records legible in an editor:
 *
 *   1. `post.title` in a page      -> `title: s.string()` in the schema
 *   2. that `title`                -> the `title` the adapter's `get` returns
 *   3. the module's `export default` -> the `entry(postsVal, ...)` that binds it
 *
 * All three depend on `ObjectSchemaSrcOf` (`object.ts`) and `JsonOf`
 * (`source/json.ts`) staying HOMOMORPHIC mapped types, because that is what makes
 * TypeScript preserve the declaration link through them. Rewrite either as a
 * `Record<string, ...>`, or wrap one in `Omit<>`, and every hop dies — with a
 * completely green typecheck and no other test failing. Hence this file.
 *
 * Hop 2 additionally depends on `ok`'s `NoInfer` (`externalRecords.ts`). Drop it
 * and the literal inside `ok({ ... })` types itself instead of being checked
 * against the contract, which severs the link just as thoroughly — and just as
 * invisibly.
 *
 * It doubles as the type-level assertion suite: the negative cases below (an
 * adapter missing `put`, a `.readonly()` record that supplies one, a binding key
 * that disagrees with the schema's label, a `files` strategy with a write path
 * and no read path, or one mixing methods from two strategies) cannot be written
 * as ordinary tests without `@ts-expect-error`, which this codebase does not
 * allow.
 */

const fixtureDir = path.join(__dirname, "../test/external-nav-fixture");

const fixtureFile = (rel: string) => path.join(fixtureDir, rel);

function createService(extraFiles: Record<string, string> = {}) {
  const onDisk = [
    "val.config.ts",
    "content/posts.val.ts",
    "content/readonly.val.ts",
    "val/external.ts",
    "app.ts",
  ].map(fixtureFile);
  const overrides = new Map(
    Object.entries(extraFiles).map(([rel, content]) => [
      fixtureFile(rel),
      content,
    ]),
  );
  const fileNames = [...onDisk, ...overrides.keys()].filter(
    (f, i, all) => all.indexOf(f) === i,
  );
  const readFile = (fileName: string) =>
    overrides.get(fileName) ?? ts.sys.readFile(fileName);

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => fileNames,
    getScriptVersion: () => "1",
    getScriptSnapshot: (fileName) => {
      const contents = readFile(fileName);
      return contents === undefined
        ? undefined
        : ts.ScriptSnapshot.fromString(contents);
    },
    getCurrentDirectory: () => fixtureDir,
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    }),
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (fileName) =>
      overrides.has(fileName) || ts.sys.fileExists(fileName),
    readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  return ts.createLanguageService(host, ts.createDocumentRegistry());
}

/** Where a span lands, as `relative/path.ts:<line text>`. */
function locate(fileName: string, span: ts.TextSpan): string {
  const contents = fs.existsSync(fileName)
    ? fs.readFileSync(fileName, "utf-8")
    : "";
  const line = contents.slice(0, span.start).split("\n").length;
  return `${path.relative(fixtureDir, fileName)}:${
    contents.split("\n")[line - 1]?.trim() ?? ""
  }`;
}

function referencesFrom(
  service: ts.LanguageService,
  rel: string,
  needle: string,
) {
  const fileName = fixtureFile(rel);
  const contents = fs.readFileSync(fileName, "utf-8");
  const position = contents.indexOf(needle);
  expect(position).toBeGreaterThanOrEqual(0);
  const found = service.findReferences(fileName, position) ?? [];
  return found.flatMap((symbol) =>
    symbol.references.map((ref) => locate(ref.fileName, ref.textSpan)),
  );
}

describe("external records stay navigable", () => {
  const service = createService();

  test("a page's field resolves to the schema field", () => {
    const fileName = fixtureFile("app.ts");
    const contents = fs.readFileSync(fileName, "utf-8");
    const definitions =
      service.getDefinitionAtPosition(
        fileName,
        contents.indexOf("post?.title") + "post?.".length,
      ) ?? [];
    const landed = definitions.map((d) => locate(d.fileName, d.textSpan));
    expect(landed).toContain("content/posts.val.ts:title: s.string(),");
  });

  test("a schema field reaches the adapter that produces it", () => {
    const refs = referencesFrom(
      service,
      "content/posts.val.ts",
      "title: s.string()",
    );
    // The hop that dies silently if JsonOf or ObjectSchemaSrcOf stops being
    // homomorphic. Nothing else in the suite would notice.
    expect(refs.some((r) => r.startsWith("val/external.ts:"))).toBe(true);
    expect(refs.some((r) => r.startsWith("app.ts:"))).toBe(true);
  });

  test("a module reaches the binding that adapts it", () => {
    // `default`, not `export default`: the `export` keyword is not an
    // identifier, and findReferences on it returns nothing at all.
    const refs = referencesFrom(service, "content/posts.val.ts", "default");
    expect(refs.some((r) => r.includes("entry(postsVal"))).toBe(true);
  });
});

describe("the adapter contract is enforced", () => {
  const diagnosticsFor = (external: string): string[] => {
    const service = createService({ "val/external.ts": external });
    const fileName = fixtureFile("val/external.ts");
    return service
      .getSemanticDiagnostics(fileName)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "));
  };

  const header = `import { defineExternal, ok } from "@valbuild/server";
import postsVal from "../content/posts.val";
import readonlyVal from "../content/readonly.val";
const { entry, modules } = defineExternal<{ q: string }>({
  around: (run) => run({ q: "" }),
});
// Bare values, not \`ok(...)\`: this object is declared with no contextual type,
// and \`ok\` infers its \`T\` only from context (see its NoInfer, above). Wrapping
// here would make every method return \`ExternalResult<unknown>\` and bury the
// error each test is actually looking for.
const reads = {
  keys: async () => ({ keys: [], cursor: null }),
  get: async () => ({}),
  search: false as const,
};
`;

  test("the fixture itself has no errors", () => {
    const service = createService();
    expect(
      service.getSemanticDiagnostics(fixtureFile("val/external.ts")),
    ).toHaveLength(0);
  });

  test("a writable record must implement put and delete", () => {
    const messages = diagnosticsFor(
      header +
        `export default modules({ posts: entry(postsVal, { ...reads }) });`,
    );
    expect(messages.join("\n")).toMatch(/put, delete|'put'|'delete'/);
  });

  test("a .readonly() record must NOT implement them", () => {
    const messages = diagnosticsFor(
      header +
        `export default modules({
  skus: entry(readonlyVal, { ...reads, put: async () => ok(undefined) }),
});`,
    );
    // The type is named so the compiler prints the reason: a bare `never` would
    // report only "not assignable to type 'undefined'".
    expect(messages.join("\n")).toContain("ReadonlyRecordHasNoWrites");
  });

  const writable = `    ...reads,
    put: async () => ok(undefined),
    delete: async () => ok(undefined),`;

  test("files: a well-formed strategy compiles", () => {
    // The control for the two below: if the union is ever tightened past what a
    // real adapter can satisfy, this is what goes red first.
    const messages = diagnosticsFor(
      header +
        `export default modules({
  posts: entry(postsVal, {
${writable}
    files: { type: "bytes", put: async () => ({}), get: async () => null },
  }),
});`,
    );
    expect(messages).toEqual([]);
  });

  test("files: a write path without its read path does not compile", () => {
    // The reason media is a union and not four optional siblings. As separate
    // optional methods this was a runtime check that could only fire once
    // someone had already uploaded something.
    const messages = diagnosticsFor(
      header +
        `export default modules({
  posts: entry(postsVal, {
${writable}
    files: { type: "bytes", put: async () => ({}) },
  }),
});`,
    );
    expect(messages.join("\n")).toContain("Property 'get' is missing in type");
  });

  test("files: methods from two different strategies do not compile", () => {
    // The other half of the same guarantee: a `bytes` adapter cannot quietly
    // grow a `signUpload` that nothing will ever call.
    const messages = diagnosticsFor(
      header +
        `export default modules({
  posts: entry(postsVal, {
${writable}
    files: {
      type: "bytes",
      put: async () => ({}),
      get: async () => null,
      signUpload: async () => ({ url: "https://s3/put" }),
    },
  }),
});`,
    );
    expect(messages.join("\n")).toContain(
      "'signUpload' does not exist in type",
    );
  });

  test("the binding key must match the schema's label", () => {
    const messages = diagnosticsFor(
      header +
        `export default modules({
  blogposts: entry(postsVal, {
    ...reads,
    put: async () => ok(undefined),
    delete: async () => ok(undefined),
  }),
});`,
    );
    expect(messages.length).toBeGreaterThan(0);
  });
});
