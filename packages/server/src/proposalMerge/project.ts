import path from "path";
import ts from "typescript";
import {
  Internal,
  type ModuleFilePath,
  type SerializedSchema,
  type ValModule,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import {
  deepClone,
  type JSONValue,
  type ReadonlyJSONValue,
} from "@valbuild/core/patch";
import { createHash } from "crypto";
import { loadValModules, type ValModulesHost } from "../loadValModules";
import { analyzeValModule } from "../patch/ts/valModule";
import { analyzeJsonValuesEntries } from "../patch/ts/jsonValuesModule";
import type { Value } from "./threeWay";
import { validateWith, type SchemaError } from "./validate";

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

/**
 * A module, as the merge needs it: data, so whoever evaluated the project's
 * schemas can hand it over -- Val's loader here and in `val validate`, the
 * builder tab with rolldown -- and the merge itself never runs project code.
 */
export type ProjectModule = {
  /**
   * Its content, as the files hold it -- a `.jsonValues()` record's entries
   * read from their `.val.json` files, so it is merged and validated as one
   * record.
   */
  source: JSONValue;
  schema: SerializedSchema;
  /**
   * For a `.jsonValues()` record: each entry's file, by key, from the project
   * root. `null` for any other module.
   */
  entries: Record<string, string> | null;
  /**
   * The evaluated schema's own validation, custom rules too. Without it, the
   * serialized schema's rules are used (`validateModule`).
   */
  validate?: (source: Value) => SchemaError[];
};

/** A project at one commit: its files, and its modules as data. */
export type Project = {
  files: Files;
  modules: Record<ModuleFilePath, ProjectModule>;
};

/** A loaded project, as the merge takes it. */
export function projectOf(files: Files, loaded: LoadedProject): Project {
  const modules: Record<ModuleFilePath, ProjectModule> = {};
  for (const [path, { module, source, entries }] of Object.entries(
    loaded.modules,
  )) {
    const moduleFilePath = path as ModuleFilePath;
    const schema = Internal.getSchema(module);
    if (!schema) continue;
    modules[moduleFilePath] = {
      source,
      schema: schema["executeSerialize"](),
      entries,
      validate: (content) => validateWith(schema, moduleFilePath, content),
    };
  }
  return { files, modules };
}

/** A module as the project defines it, read by Val's own loader. */
export type LoadedModule = {
  module: ValModule<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /**
   * Its content, as the files hold it -- a `.jsonValues()` record's entries
   * read from their `.val.json` files, so it can be merged and validated as
   * one record.
   */
  source: JSONValue;
  /**
   * For a `.jsonValues()` record: each entry's file, by key, from the project
   * root. `null` for any other module.
   */
  entries: Record<string, string> | null;
};

export type LoadedProject = {
  valModules: ReturnType<typeof loadValModules>;
  modules: Record<ModuleFilePath, LoadedModule>;
  /** The `.val.ts` files and `.jsonValues()` entries, as `ValOpsMemory` takes them. */
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
    const moduleFilePath = id as string as ModuleFilePath;
    const text = files[moduleFilePath.slice(1)] ?? null;
    modules[moduleFilePath] = {
      module,
      // The one conversion, as `ValOps.getSources` makes it: a module's
      // Source is JSON once its entries are read (media are plain objects).
      source: deepClone(
        (await Internal.resolveJsonValues(
          Internal.getSource(module),
        )) as ReadonlyJSONValue,
      ) as JSONValue,
      entries: text === null ? null : entryFilesOf(moduleFilePath, text),
    };
  }
  const sourceFiles: Record<string, string> = {};
  for (const [file, text] of Object.entries(files)) {
    if (
      text !== null &&
      (file.endsWith(".val.ts") || file.endsWith(".val.json"))
    ) {
      sourceFiles[file] = text;
    }
  }
  return { valModules, modules, sourceFiles };
}

/**
 * A `.jsonValues()` record's entry files, by key, read out of its `.val.ts`
 * (the loaded marker does not carry the path). `null` when it has none.
 */
export function entryFilesOf(
  moduleFilePath: ModuleFilePath,
  text: string,
): Record<string, string> | null {
  const analysis = analyzeValModule(
    ts.createSourceFile(moduleFilePath, text, ts.ScriptTarget.ES2015, true),
  );
  if (result.isErr(analysis)) return null;
  const entries = analyzeJsonValuesEntries(analysis.value.source);
  if (entries.size === 0) return null;
  const dir = path.posix.dirname(moduleFilePath.slice(1));
  return Object.fromEntries(
    [...entries].map(([key, { importPath }]) => [
      key,
      path.posix.join(dir, importPath),
    ]),
  );
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
  /** Files the page's content lives in besides its `.val.ts`: `.jsonValues()` entries. */
  files: Files;
  /** The same file with another schema: what a proposal stages to change it. */
  withSchema(schema: string, content: unknown): string;
};

export function page(file: string, schema: string, content: unknown): Page {
  return {
    file,
    moduleFilePath: `/${file}` as ModuleFilePath,
    text: valFile(file, schema, content),
    files: {},
    withSchema: (other, otherContent) => valFile(file, other, otherContent),
  };
}

/**
 * A `.jsonValues()` record: each entry in a `.val.json` of its own, next to the
 * module in a directory named after it, as the Studio writes new ones.
 */
export function jsonValuesPage(
  file: string,
  itemSchema: string,
  entries: Record<string, unknown>,
): Page {
  const dir = file.replace(/\.val\.ts$/, "");
  const schema = `s.record(${itemSchema}).jsonValues()`;
  const text = [
    `import { s, c } from "./val.config";`,
    ``,
    `export default c.define("/${file}", ${schema}, {`,
    ...Object.keys(entries).map(
      (key) => `  "${key}": c.json(() => import("./${dir}/${key}.val.json")),`,
    ),
    `});`,
    ``,
  ].join("\n");
  return {
    file,
    moduleFilePath: `/${file}` as ModuleFilePath,
    text,
    files: Object.fromEntries(
      Object.entries(entries).map(([key, content]) => [
        `${dir}/${key}.val.json`,
        JSON.stringify(content, null, 2),
      ]),
    ),
    withSchema: () => {
      throw new Error("not written for a .jsonValues() page yet");
    },
  };
}

// --- code and content ------------------------------------------------------------

/**
 * A file's code: for a `.val.ts`, everything but `c.define`'s content
 * argument, which Val reads at request time (step 2) and so is no part of a
 * build; a `.val.json` entry is no code at all. Every other file is code
 * whole.
 */
export function codeOf(file: string, text: string): string {
  // A `.jsonValues()` entry is content, read at request time like the rest.
  if (file.endsWith(".val.json")) return "";
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
