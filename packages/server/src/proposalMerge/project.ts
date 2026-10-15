import path from "path";
import ts from "typescript";
import { Internal, type ModuleFilePath, type ValModule } from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { createHash } from "crypto";
import { loadValModules, type ValModulesHost } from "../loadValModules";
import { analyzeValModule } from "../patch/ts/valModule";

/**
 * A project as git holds it: every file's text, by path from the project
 * root. A commit in the world is one of these -- `.val.ts` files, the
 * components that render them, `val.modules.ts` -- and nothing else, the same
 * way a commit on content's line is.
 */
export type Files = Record<string, string | null>;

/**
 * Where the files are said to be. Nothing is written there: the loader reads
 * through {@link host}, which answers from the files for anything under it and
 * from the disk for everything else, so `@valbuild/core` resolves to the one
 * the tests run on.
 */
const ROOT = path.join(__dirname, "__project__");

function host(files: Files): ValModulesHost {
  const byAbs = new Map<string, string>();
  for (const [file, text] of Object.entries(files)) {
    if (text !== null) byAbs.set(path.join(ROOT, file), text);
  }
  const dirs = new Set<string>();
  for (const file of byAbs.keys()) {
    for (let dir = path.dirname(file); dir.startsWith(ROOT); ) {
      dirs.add(dir);
      dir = path.dirname(dir);
    }
  }
  const inProject = (p: string) => p === ROOT || p.startsWith(ROOT + path.sep);
  return {
    ...ts.sys,
    fileExists: (p) => (inProject(p) ? byAbs.has(p) : ts.sys.fileExists(p)),
    readFile: (p) => (inProject(p) ? byAbs.get(p) : ts.sys.readFile(p)),
    directoryExists: (p) =>
      inProject(p) ? dirs.has(p) : (ts.sys.directoryExists?.(p) ?? false),
  };
}

/** A module as the project defines it, read by Val's own loader. */
export type LoadedModule = {
  module: ValModule<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  source: unknown;
};

export type LoadedProject = {
  valModules: ReturnType<typeof loadValModules>;
  modules: Record<ModuleFilePath, LoadedModule>;
  /** The `.val.ts` files, as `ValOpsMemory` takes them. */
  sourceFiles: Record<string, string>;
};

/**
 * Loads the project at a commit the way `val validate` does: `val.modules.ts`
 * and every `.val.ts` it imports, transpiled and evaluated
 * (`loadValModules`). So a schema a proposal changed is the schema it changed
 * to, read from the text it wrote.
 */
export async function loadProject(files: Files): Promise<LoadedProject> {
  const valModules = loadValModules(ROOT, host(files));
  const modules: Record<ModuleFilePath, LoadedModule> = {};
  for (const { def } of valModules.modules) {
    const module = (await def()).default;
    const id = Internal.getValPath(module);
    if (id === undefined) continue;
    modules[id as string as ModuleFilePath] = {
      module,
      source: Internal.getSource(module),
    };
  }
  const sourceFiles: Record<string, string> = {};
  for (const [file, text] of Object.entries(files)) {
    if (text !== null && file.endsWith(".val.ts")) sourceFiles[file] = text;
  }
  return { valModules, modules, sourceFiles };
}

// --- writing a project ---------------------------------------------------------

/** Every project's first two files, as `npm create @valbuild` writes them. */
export function scaffold(moduleFiles: string[]): Files {
  return {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, esModuleInterop: true },
      files: ["val.modules.ts"],
    }),
    "val.config.ts": [
      `import { initVal } from "@valbuild/core";`,
      `export const { s, c, config } = initVal();`,
      ``,
    ].join("\n"),
    "val.modules.ts": valModulesFile(moduleFiles),
  };
}

/** `val.modules.ts` naming these modules: what adding a page changes. */
export function valModulesFile(moduleFiles: string[]): string {
  return [
    `import { modules } from "@valbuild/core";`,
    `import { config } from "./val.config";`,
    ``,
    `export default modules(config, [`,
    ...moduleFiles.map(
      (file) => `  { def: () => import("./${file.replace(/\.ts$/, "")}") },`,
    ),
    `]);`,
    ``,
  ].join("\n");
}

/**
 * A `.val.ts` file: `c.define` with a schema written as code and its content.
 * The text is the file; a proposal that changes the schema writes another
 * one.
 */
export function valFile(
  file: string,
  schema: string,
  content: unknown,
): string {
  return [
    `import { s, c } from "./val.config";`,
    ``,
    `export default c.define(`,
    `  "/${file}",`,
    `  ${schema},`,
    `  ${JSON.stringify(content, null, 2).replace(/\n/g, "\n  ")},`,
    `);`,
    ``,
  ].join("\n");
}

/** A page of the world: its `.val.ts`, as the site starts with it. */
export type Page = {
  file: string;
  moduleFilePath: ModuleFilePath;
  text: string;
  /** The same file with another schema: what a proposal stages to change it. */
  withSchema(schema: string, content: unknown): string;
};

export function page(file: string, schema: string, content: unknown): Page {
  return {
    file,
    moduleFilePath: `/${file}` as ModuleFilePath,
    text: valFile(file, schema, content),
    withSchema: (other, otherContent) => valFile(file, other, otherContent),
  };
}

// --- code and content ------------------------------------------------------------

/**
 * A file's code: for a `.val.ts`, everything but `c.define`'s content
 * argument, which Val reads at request time (step 2) and so is no part of a
 * build. Every other file is code whole.
 */
export function codeOf(file: string, text: string): string {
  if (!file.endsWith(".val.ts")) return text;
  const analysis = analyzeValModule(
    ts.createSourceFile(file, text, ts.ScriptTarget.ES2015, true),
  );
  if (result.isErr(analysis)) return text;
  const { source } = analysis.value;
  return (
    text.slice(0, source.getStart()) + "/* content */" + text.slice(source.end)
  );
}

/** A build's name: the hash of the code it is made of (step 3). */
export function buildName(files: Files): string {
  const hash = createHash("sha256");
  for (const file of Object.keys(files).sort()) {
    const text = files[file];
    if (text === null) continue;
    hash.update(`${file}\u0000${codeOf(file, text)}\u0000`);
  }
  return `build-${hash.digest("hex").slice(0, 8)}`;
}
