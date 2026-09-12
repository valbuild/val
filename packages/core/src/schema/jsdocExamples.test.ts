import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

/**
 * Two things about the `@example`s on schema methods, which are what a
 * developer sees on hover:
 *
 * 1. Every method a developer can call has one.
 * 2. Every one of them compiles.
 *
 * The first check goes THROUGH THE TYPE CHECKER rather than grepping the source
 * for `@example`, because what a developer sees is the doc TypeScript resolves
 * for the symbol, which is not always the doc written next to the method:
 *
 * - `nullable()`, `readonly()` and `hidden()` are declared abstract on
 *   {@link Schema} and overridden without a comment in every schema class. The
 *   checker walks to the base declaration, so one doc serves them all - a grep
 *   would report a failure for each override, and none of them would be real.
 * - A doc on a base member that a subclass shadows with a comment of its own
 *   stops being visible. Only asking the checker catches that.
 *
 * The second check is what makes the first worth having. An example that does
 * not compile teaches the wrong thing with the authority of documentation, and
 * nothing else in the build looks inside a comment: the `validate` examples
 * were all written as `ok || "message"` - which reads perfectly and is a type
 * error, because the signature wants `false | string` and `||` yields `true`.
 */

const SCHEMA_DIR = __dirname;
const CORE_SRC = path.join(__dirname, "..");

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  resolveJsonModule: true,
};

/**
 * A compiler host that serves `files` from memory and everything else from
 * disk. `directoryExists` has to be overridden too: module resolution gives up
 * on a directory the host says is not there, and no virtual directory is.
 */
function inMemoryHost(files: Map<string, string>): ts.CompilerHost {
  const host = ts.createCompilerHost(COMPILER_OPTIONS, true);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  const directoryExists = host.directoryExists?.bind(host);
  const directories = new Set<string>();
  for (const file of files.keys()) {
    let dir = path.dirname(file);
    while (dir && dir !== path.dirname(dir) && !directories.has(dir)) {
      directories.add(dir);
      dir = path.dirname(dir);
    }
  }
  host.readFile = (fileName) => files.get(fileName) ?? readFile(fileName);
  host.fileExists = (fileName) => files.has(fileName) || fileExists(fileName);
  host.directoryExists = (dirName) =>
    directories.has(dirName) || !!directoryExists?.(dirName);
  host.getSourceFile = (fileName, languageVersion, ...rest) => {
    const contents = files.get(fileName);
    return contents === undefined
      ? getSourceFile(fileName, languageVersion, ...rest)
      : ts.createSourceFile(fileName, contents, languageVersion, true);
  };
  return host;
}

function diagnosticsOf(program: ts.Program, file: ts.SourceFile): string[] {
  return program
    .getSemanticDiagnostics(file)
    .concat(program.getSyntacticDiagnostics(file))
    .map((diagnostic) => {
      const at =
        diagnostic.file && diagnostic.start !== undefined
          ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
          : undefined;
      return `${at ? `line ${at.line + 1}: ` : ""}${ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        " ",
      )}`;
    });
}

// ---------------------------------------------------------------------------
// 1. Every schema method a developer can call has an example
// ---------------------------------------------------------------------------

const PROBE = path.join(CORE_SRC, "__jsdocExamplesProbe__.ts");

/**
 * One value per schema `s` can produce, which is what fixes the set of types
 * under test. "every schema `s` can produce is probed" below is what stops a
 * new factory being added to `s` and quietly going unchecked.
 */
const PROBE_SOURCE = `
import { initVal } from "./initVal";
import { nextAppRouter } from "./router";

const { s, c, val } = initVal();

const authorsVal = c.define("/authors.val.ts", s.record(s.string()), {
  ada: "Ada",
});
const galleryVal = c.define(
  "/gallery.val.ts",
  s.images({ directory: "/public/val/images" }),
  {},
);

export const constructor = s;
export const content = c;
export const helpers = val;
export const probes = {
  string: s.string(),
  boolean: s.boolean(),
  number: s.number(),
  literal: s.literal("hero"),
  array: s.array(s.string()),
  object: s.object({ title: s.string() }),
  union: s.union(s.literal("a"), s.literal("b")),
  discriminatedUnion: s.discriminatedUnion(
    "type",
    s.object({ type: s.literal("a"), a: s.string() }),
    s.object({ type: s.literal("b"), b: s.string() }),
  ),
  enum: s.enum("a", "b"),
  record: s.record(s.string()),
  keyOf: s.keyOf(authorsVal),
  richtext: s.richtext(),
  image: s.image(),
  file: s.file(),
  date: s.date(),
  datetime: s.datetime(),
  color: s.color(),
  code: s.code(),
  route: s.route(),
  router: s.router(nextAppRouter, s.object({ title: s.string() })),
  images: s.images({ directory: "/public/val/images" }),
  files: s.files({ accept: "*/*", directory: "/public/val/files" }),
  settings: s.settings(),
};
export const galleryBackedImage = s.image(galleryVal);
`;

/**
 * Public members a developer never writes in a `.val.ts`.
 *
 * A list of names rather than a convention, because `public` is TypeScript's
 * default: a method that should have been `protected` but was never marked
 * would otherwise leave the check silently, where here it has to be argued for.
 */
const NOT_AUTHORED_BY_DEVELOPERS = new Set([
  // Called by the server once it has loaded a `.jsonValues()` entry. It takes a
  // SourcePath, which nothing in a `.val.ts` has a way to construct.
  "validateJsonEntryContent",
]);

const probeProgram = ts.createProgram(
  [PROBE],
  COMPILER_OPTIONS,
  inMemoryHost(new Map([[PROBE, PROBE_SOURCE]])),
);
const checker = probeProgram.getTypeChecker();
const probeFile = probeProgram.getSourceFile(PROBE);
if (!probeFile) {
  throw new Error("Could not create the probe source file");
}

function exportedType(name: string): ts.Type {
  const moduleSymbol = checker.getSymbolAtLocation(probeFile as ts.SourceFile);
  if (!moduleSymbol) {
    throw new Error("The probe is not a module");
  }
  const symbol = checker
    .getExportsOfModule(moduleSymbol)
    .find((exported) => exported.getName() === name);
  if (!symbol || !symbol.valueDeclaration) {
    throw new Error(`The probe does not export '${name}'`);
  }
  return checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration);
}

/** The members of a type a developer can reach: public, and callable. */
function publicMethods(type: ts.Type): ts.Symbol[] {
  return type.getProperties().filter((symbol) => {
    if (NOT_AUTHORED_BY_DEVELOPERS.has(symbol.getName())) {
      return false;
    }
    const declaration = symbol.declarations?.[0];
    if (!declaration) {
      return false;
    }
    const modifiers = ts.getCombinedModifierFlags(declaration);
    if (modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) {
      return false;
    }
    return (
      ts.isMethodDeclaration(declaration) ||
      ts.isMethodSignature(declaration) ||
      ts.isPropertySignature(declaration)
    );
  });
}

/** The `@example` tags an editor shows for a symbol, base classes included. */
function examplesOf(symbol: ts.Symbol): string[] {
  return symbol
    .getJsDocTags(checker)
    .filter((tag) => tag.name === "example")
    .map((tag) => ts.displayPartsToString(tag.text));
}

function methodsWithoutExample(label: string, type: ts.Type): string[] {
  const methods = publicMethods(type);
  if (methods.length === 0) {
    throw new Error(
      `No public methods found on '${label}' - the probe is wrong`,
    );
  }
  return methods
    .filter((method) => examplesOf(method).length === 0)
    .map((method) => `${label}.${method.getName()}()`);
}

const probeNames = exportedType("probes")
  .getProperties()
  .map((symbol) => symbol.getName());

describe("schema JSDoc examples: every method has one", () => {
  test("the probe type checks", () => {
    // Without this, a probe that failed to compile would hand every test below
    // an `any` with no members, and they would all pass.
    expect(diagnosticsOf(probeProgram, probeFile as ts.SourceFile)).toEqual([]);
  });

  test("every schema constructor on `s` has an example", () => {
    expect(methodsWithoutExample("s", exportedType("constructor"))).toEqual([]);
  });

  test("every content constructor on `c` has an example", () => {
    expect(methodsWithoutExample("c", exportedType("content"))).toEqual([]);
  });

  test("every helper on `val` has an example", () => {
    expect(methodsWithoutExample("val", exportedType("helpers"))).toEqual([]);
  });

  test("every schema `s` can produce is probed", () => {
    const constructors = publicMethods(exportedType("constructor")).map(
      (symbol) => symbol.getName(),
    );
    expect([...constructors].sort()).toEqual([...probeNames].sort());
  });

  test.each(probeNames)("s.%s(): every method has an example", (name) => {
    const symbol = exportedType("probes").getProperty(name);
    if (!symbol) {
      throw new Error(`No probe named '${name}'`);
    }
    const type = checker.getTypeOfSymbolAtLocation(
      symbol,
      probeFile as ts.SourceFile,
    );
    expect(methodsWithoutExample(`s.${name}()`, type)).toEqual([]);
  });

  test("s.image(gallery): every method has an example", () => {
    // A gallery-backed image is a different instantiation of ImageSchema, and
    // the overload a developer lands on from `s.image(galleryVal)`.
    expect(
      methodsWithoutExample(
        "s.image(gallery)",
        exportedType("galleryBackedImage"),
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Every example compiles
// ---------------------------------------------------------------------------

type Example = { file: string; line: number; code: string };

/**
 * The `@example` bodies in a file, as source.
 *
 * Read out of the TEXT rather than off the AST, because an example is a comment
 * either way and the text is where the indentation and the fences are. The
 * shapes in this codebase are `@example` followed by lines of code, and
 * `@example <caption>` followed by a fenced block.
 */
function examplesIn(file: string): Example[] {
  const found: Example[] = [];
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let inDoc = false;
  let current: { line: number; body: string[] } | null = null;
  const flush = () => {
    if (!current) {
      return;
    }
    const fence = current.body.findIndex((l) =>
      l.trimStart().startsWith("```"),
    );
    const body =
      fence === -1
        ? current.body
        : current.body.slice(
            fence + 1,
            current.body.findIndex((l, i) => i > fence && l.trim() === "```"),
          );
    const code = body.join("\n").trim();
    if (code) {
      found.push({ file, line: current.line, code });
    }
    current = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("/**")) {
      inDoc = true;
      flush();
      continue;
    }
    if (!inDoc) {
      continue;
    }
    if (trimmed.endsWith("*/")) {
      inDoc = false;
      flush();
      continue;
    }
    const body = trimmed.replace(/^\*\s?/, "");
    if (body.startsWith("@example")) {
      flush();
      const caption = body.slice("@example".length).trim();
      current = { line: i + 1, body: [] };
      // `@example Next.js App Router` — a caption, not the first line of code.
      if (caption && !caption.startsWith("//") && /[;({=]/.test(caption)) {
        current.body.push(caption);
      }
      continue;
    }
    if (body.startsWith("@")) {
      flush();
      continue;
    }
    if (current) {
      current.body.push(body);
    }
  }
  flush();
  return found;
}

const EXAMPLES_DIR = path.join(CORE_SRC, "__jsdocExamples__");

/**
 * What a `.val.ts` has around it. The examples are written the way a developer
 * writes one — `s` and `c` from the project's config, content modules imported
 * by path — so the check has to supply the same surroundings.
 */
const EXAMPLE_FIXTURES: [string, string][] = [
  [
    "val.config.ts",
    `import { initVal } from "../initVal";
export { nextAppRouter, tanstackRouter, externalPageRouter } from "../router";
export const { s, c, val, config } = initVal();
`,
  ],
  [
    "authors.val.ts",
    `import { s, c } from "./val.config";
export default c.define("/authors.val.ts", s.record(s.string()), {
  ada: "Ada",
});
`,
  ],
  [
    "other.val.ts",
    `import { s, c } from "./val.config";
export default c.define("/other.val.ts", s.record(s.string()), {
  test: "test",
});
`,
  ],
  [
    "gallery.val.ts",
    `import { s, c } from "./val.config";
export default c.define(
  "/gallery.val.ts",
  s.images({ directory: "/public/val/images" }),
  {},
);
`,
  ],
  [
    "page.val.ts",
    `import { s, c } from "./val.config";
export default c.define("/page.val.ts", s.object({ title: s.string() }), {
  title: "Hello",
});
`,
  ],
  ["content/faq.val.json", `{ "title": "FAQ", "body": "Body" }`],
];

const DOCUMENTED_FILES = [
  path.join(CORE_SRC, "initSchema.ts"),
  path.join(CORE_SRC, "initVal.ts"),
  ...fs
    .readdirSync(SCHEMA_DIR)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .sort()
    .map((file) => path.join(SCHEMA_DIR, file)),
];

const allExamples = DOCUMENTED_FILES.flatMap(examplesIn);

const exampleFiles = new Map<string, string>(
  EXAMPLE_FIXTURES.map(([name, contents]) => [
    path.join(EXAMPLES_DIR, name),
    contents,
  ]),
);
const compiled = allExamples.map((example, index) => {
  const fileName = path.join(EXAMPLES_DIR, `example_${index}.ts`);
  const code = example.code
    // A `.val.ts` sits in a content directory, so it reaches the config as
    // `../val.config`. Here everything is one directory.
    .replace(/from "\.\.\/val\.config"/g, 'from "./val.config"');
  // `s`, `c` and `val` come from the project's config, so an example that uses
  // one gets it imported — unless the example brings its own, which the ones
  // that call `initVal` themselves do.
  const declared = new Set<string>();
  for (const binding of code.matchAll(
    /(?:import|const|let|var)\s*\{([^}]*)\}/g,
  )) {
    for (const name of binding[1].split(",")) {
      declared.add(
        name
          .split(/\s+as\s+/)
          .pop()!
          .trim(),
      );
    }
  }
  const needed = (["s", "c", "val"] as const).filter(
    (name) =>
      // `\s*` because a chained example breaks the line right after `s`.
      new RegExp(`\\b${name}\\s*\\.`).test(code) && !declared.has(name),
  );
  const preamble = needed.length
    ? `import { ${needed.join(", ")} } from "./val.config";\n`
    : "";
  exampleFiles.set(fileName, preamble + code + "\n");
  return { fileName, example };
});

const examplesProgram = ts.createProgram(
  [...exampleFiles.keys()],
  COMPILER_OPTIONS,
  inMemoryHost(exampleFiles),
);

describe("schema JSDoc examples: they compile", () => {
  test("there are examples to check", () => {
    // A refactor that moves the docs elsewhere should fail loudly here rather
    // than leave a suite that checks nothing and passes.
    expect(allExamples.length).toBeGreaterThan(100);
  });

  test("the fixtures compile", () => {
    const broken = EXAMPLE_FIXTURES.flatMap(([name]) => {
      const file = examplesProgram.getSourceFile(path.join(EXAMPLES_DIR, name));
      return file
        ? diagnosticsOf(examplesProgram, file).map((e) => `${name}: ${e}`)
        : [`${name}: not in the program`];
    });
    expect(broken).toEqual([]);
  });

  test("every @example compiles", () => {
    const broken: string[] = [];
    for (const { fileName, example } of compiled) {
      const file = examplesProgram.getSourceFile(fileName);
      if (!file) {
        broken.push(`${example.file}:${example.line}: not in the program`);
        continue;
      }
      for (const diagnostic of diagnosticsOf(examplesProgram, file)) {
        broken.push(
          `${path.basename(example.file)}:${example.line}: ${diagnostic}\n` +
            example.code.replace(/^/gm, "    "),
        );
      }
    }
    expect(broken).toEqual([]);
  });
});
