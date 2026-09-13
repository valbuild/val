import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

/**
 * Two things about the `@example`s on what `initVal()` hands back, which are
 * what a developer sees on hover:
 *
 * 1. Every member has one.
 * 2. Every one of them compiles.
 *
 * The same pair `@valbuild/core` runs over `s` (see
 * `packages/core/src/schema/jsdocExamples.test.ts`), narrowed to what THIS
 * package adds on top: `isValEnabled`, the routers, and the extra `val`
 * helpers. The presence check goes through the type checker rather than
 * grepping for `@example`, because what a developer sees is the doc TypeScript
 * resolves for the symbol - which for an intersection like `val` is spread
 * over two declarations.
 *
 * The compile check needs more scaffolding here than in core: these examples
 * read content with `useVal`, which is not exported by this package at all. It
 * comes from the app's OWN `val/client.ts` - what `initValClient(config)`
 * returns - so the fixtures below stand in for a project's config, client and
 * a content module. Without them the examples were unchecked, and the
 * `val.attrs` one had been wrong since it was written: a `useVal(pageVal)`
 * with no semicolon followed by a line starting with `<` does not parse as
 * JSX.
 */

const SRC = __dirname;
const EXAMPLES_DIR = path.join(SRC, "__jsdocExamples__");
const ROUTER = "nextAppRouter";

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  // The `val.attrs` example is JSX, which is the shape that example has to
  // have - it is about an attribute spread onto an element.
  jsx: ts.JsxEmit.ReactJSX,
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
// 1. Every member of initVal() has an example
// ---------------------------------------------------------------------------

const PROBE = path.join(SRC, "__jsdocExamplesProbe__.ts");
const PROBE_SOURCE = `
import { initVal } from "./initVal";

export const valSystem = initVal();
export const valHelpers = valSystem.val;
`;

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

function membersWithoutExample(label: string, type: ts.Type): string[] {
  const members = type.getProperties().filter((symbol) => {
    const declaration = symbol.declarations?.[0];
    if (!declaration) {
      return false;
    }
    const modifiers = ts.getCombinedModifierFlags(declaration);
    if (modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) {
      return false;
    }
    return (
      ts.isPropertySignature(declaration) ||
      ts.isMethodSignature(declaration) ||
      ts.isMethodDeclaration(declaration)
    );
  });
  if (members.length === 0) {
    throw new Error(`No members found on '${label}' - the probe is wrong`);
  }
  return members
    .filter(
      (member) =>
        member.getJsDocTags(checker).filter((tag) => tag.name === "example")
          .length === 0,
    )
    .map((member) => `${label}.${member.getName()}`);
}

describe("initVal JSDoc examples: every member has one", () => {
  test("the probe type checks", () => {
    // Without this, a probe that failed to compile would hand the tests below
    // an `any` with no members, and they would pass having checked nothing.
    expect(diagnosticsOf(probeProgram, probeFile as ts.SourceFile)).toEqual([]);
  });

  test("every member of initVal() has an example", () => {
    expect(
      membersWithoutExample("initVal()", exportedType("valSystem")),
    ).toEqual([]);
  });

  test("every helper on `val` has an example", () => {
    expect(membersWithoutExample("val", exportedType("valHelpers"))).toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Every example compiles
// ---------------------------------------------------------------------------

type Example = { file: string; line: number; code: string };

/**
 * The `@example` bodies in a file, as source. Read out of the TEXT rather than
 * off the AST, because an example is a comment either way and the text is
 * where the indentation and the fences are.
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
      // `@example Next.js App Router` - a caption, not the first line of code.
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

/**
 * What a project has around a `.val.ts` and the component that reads it: the
 * config `initVal` produced, the client `initValClient` produced, and one
 * content module. The examples are written the way an app writes them, so the
 * check has to supply the same surroundings.
 */
const EXAMPLE_FIXTURES: [string, string][] = [
  [
    "val.config.ts",
    `import { initVal } from "../initVal";
export const { s, c, val, config, isValEnabled, ${ROUTER}, externalPageRouter } =
  initVal();
`,
  ],
  [
    "val.client.ts",
    `import { initValClient } from "../client/initValClient";
import { config } from "./val.config";
const { useValStega: useVal } = initValClient(config);
export { useVal };
`,
  ],
  [
    "page.val.ts",
    `import { s, c } from "./val.config";
export default c.define(
  "/page.val.ts",
  s.object({
    title: s.string(),
    slug: s.string().raw(),
    url: s.object({ href: s.string().raw(), label: s.string() }),
  }),
  {
    title: "Hello",
    slug: "hello",
    url: { href: "https://val.build", label: "Val" },
  },
);
`,
  ],
];

const allExamples = examplesIn(path.join(SRC, "initVal.ts"));

const exampleFiles = new Map<string, string>(
  EXAMPLE_FIXTURES.map(([name, contents]) => [
    path.join(EXAMPLES_DIR, name),
    contents,
  ]),
);
const compiled = allExamples.map((example, index) => {
  // A `.val.ts` sits in a content directory, so it reaches the config as
  // `../val.config`. Here everything is one directory.
  const code = example.code.replace(
    /from "\.\.\/val\.config"/g,
    'from "./val.config"',
  );
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
  const uses = (name: string) =>
    // `s`, `c` and `val` are only ever used as receivers; a router is passed
    // bare, as an argument.
    (["s", "c", "val"].includes(name)
      ? new RegExp(`\\b${name}\\s*[.(]`)
      : new RegExp(`\\b${name}\\b`)
    ).test(code) && !declared.has(name);
  const fromConfig = [
    "s",
    "c",
    "val",
    "isValEnabled",
    ROUTER,
    "externalPageRouter",
  ].filter(uses);
  const preamble: string[] = [];
  if (fromConfig.length > 0) {
    preamble.push(`import { ${fromConfig.join(", ")} } from "./val.config";`);
  }
  if (/\buseVal\s*\(/.test(code) && !declared.has("useVal")) {
    preamble.push(`import { useVal } from "./val.client";`);
  }
  // `.tsx`, because one of these examples is JSX and the rest do not mind.
  const fileName = path.join(EXAMPLES_DIR, `example_${index}.tsx`);
  exampleFiles.set(
    fileName,
    (preamble.length > 0 ? preamble.join("\n") + "\n" : "") + code + "\n",
  );
  return { fileName, example };
});

const examplesProgram = ts.createProgram(
  [...exampleFiles.keys()],
  COMPILER_OPTIONS,
  inMemoryHost(exampleFiles),
);

describe("initVal JSDoc examples: they compile", () => {
  test("there are examples to check", () => {
    // A refactor that moves the docs elsewhere should fail loudly here rather
    // than leave a suite that checks nothing and passes.
    expect(allExamples.length).toBeGreaterThan(5);
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
