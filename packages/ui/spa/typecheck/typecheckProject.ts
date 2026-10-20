import type * as TS from "typescript";
import { parse } from "yaml";
import {
  packageDirOf,
  SourceError,
  TypeAcquisition,
  type AcquisitionStats,
  type MissingTypes,
  type TypecheckSources,
} from "./acquireTypes";
import { LinkedFileSystem, parentOf } from "./linkedFileSystem";
import {
  computePnpmLayout,
  layoutOptionsOfWorkspace,
  normalizePath,
  type PnpmLayout,
} from "./pnpmLayout";
import { typescriptVersion } from "./lockedVersions";
import { parsePnpmLockfile, type PnpmLockfile } from "./pnpmLockfile";
import {
  BUNDLED_TYPESCRIPT,
  chooseCompiler,
  evaluateTypeScript,
  matchFilesOf,
  type CompilerBundle,
  type CompilerChoice,
  type TypeScript,
} from "./typescriptCompiler";

/**
 * The type errors a project would have after `pnpm install`, computed in
 * memory: the layout from the lockfile, the types its imports reach from
 * adept, and the project's own TypeScript over both. See `docs` in
 * valbuild/home's `adept.md`, step 4.
 */

export type TypecheckInput = {
  /** The project's files, by `/`-separated path relative to its root. */
  files: Record<string, string>;
  lockfile: string;
  /** `pnpm-workspace.yaml`, when the project has one: it can change the layout. */
  workspace?: string | null;
  sources: TypecheckSources;
  onProgress?: (progress: TypecheckProgress) => void;
  /** Also return every file in each program, as `tsc --listFiles` prints them. */
  listFiles?: boolean;
};

export type TypecheckProgress =
  | { step: "layout" }
  | { step: "compiler"; version: string }
  | { step: "types"; fetched: number }
  | { step: "check"; tsconfig: string };

export type TypeErrorEntry = {
  /** Relative to the project's root; `null` for an error of no file (an option, a missing lib). */
  file: string | null;
  /** 1-based. */
  line: number | null;
  column: number | null;
  code: number;
  message: string;
  /** The tsconfig whose program reported it. */
  tsconfig: string;
};

export type ProgramSummary = {
  tsconfig: string;
  /** Files in the program, the project's and the declarations it reached. */
  files: number;
  errors: number;
  /** With `listFiles`: each file's path, relative to the project's root when it is under it. */
  fileNames?: string[];
};

export type TypecheckResult = {
  errors: TypeErrorEntry[];
  programs: ProgramSummary[];
  typescript: CompilerChoice;
  bundles: AcquisitionStats & { count: number; rounds: number };
  /** Packages whose types could not be fetched: errors about them may be wrong. */
  missing: MissingTypes[];
  timings: {
    layoutMs: number;
    compilerMs: number;
    typesMs: number;
    checkMs: number;
    totalMs: number;
  };
};

/** The project's root in the file system the checker builds. */
export const PROJECT_ROOT = "/project";
const COMPILER_ROOT = "/typescript";

/**
 * At most this many rounds of "build the programs, fetch what TypeScript
 * looked for and did not find". Each round fetches only what the round
 * before uncovered, so this is a guard against a loop, not a budget: the
 * templates need one or two.
 */
const MAX_RESOLUTION_ROUNDS = 8;

/** A tsconfig and the program it describes. */
type ProjectConfig = {
  path: string;
  options: TS.CompilerOptions;
  rootNames: string[];
  projectReferences: readonly TS.ProjectReference[] | undefined;
  errors: TS.Diagnostic[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const relative = (path: string) =>
  path === PROJECT_ROOT
    ? "."
    : path.startsWith(`${PROJECT_ROOT}/`)
      ? path.slice(PROJECT_ROOT.length + 1)
      : path;

/**
 * Every `tsconfig.json` in the project, and every config their `references`
 * name, in a stable order. A solution-style config (no files of its own,
 * only references) is not a program; the configs it references are.
 */
function readConfigs(
  ts: TypeScript,
  fs: LinkedFileSystem,
  projectFiles: string[],
): ProjectConfig[] {
  const matchFiles = matchFilesOf(ts);
  const host: TS.ParseConfigHost = {
    useCaseSensitiveFileNames: true,
    fileExists: (path) => fs.fileExists(path),
    readFile: (path) => fs.readFile(path),
    readDirectory: (root, extensions, excludes, includes, depth) =>
      matchFiles(
        root,
        extensions,
        excludes,
        includes,
        true,
        PROJECT_ROOT,
        depth,
        (path) => ({
          files: fs.getFiles(path),
          directories: fs.getDirectories(path),
        }),
        (path) => fs.realpath(path),
      ),
  };
  const queue = projectFiles
    .filter(
      (path) =>
        path.endsWith("/tsconfig.json") && !path.includes("/node_modules/"),
    )
    .sort();
  const seen = new Set<string>();
  const configs: ProjectConfig[] = [];
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    if (seen.has(path)) continue;
    seen.add(path);
    const read = ts.readConfigFile(path, (file) => fs.readFile(file));
    const dir = parentOf(path);
    if (read.error) {
      configs.push({
        path,
        options: {},
        rootNames: [],
        projectReferences: undefined,
        errors: [read.error],
      });
      continue;
    }
    const parsed = ts.parseJsonConfigFileContent(
      read.config,
      host,
      dir,
      undefined,
      path,
    );
    for (const reference of parsed.projectReferences ?? []) {
      const target = normalizePath(reference.path);
      queue.push(target.endsWith(".json") ? target : `${target}/tsconfig.json`);
    }
    const solutionOnly =
      parsed.fileNames.length === 0 &&
      (parsed.projectReferences?.length ?? 0) > 0;
    if (solutionOnly) continue;
    configs.push({
      path,
      options: parsed.options,
      rootNames: parsed.fileNames,
      projectReferences: parsed.projectReferences,
      errors: parsed.errors,
    });
  }
  return configs;
}

/** A language service over the in-memory files, for one tsconfig. */
function languageServiceFor(
  ts: TypeScript,
  fs: LinkedFileSystem,
  config: ProjectConfig,
  registry: TS.DocumentRegistry,
): TS.LanguageService {
  const snapshots = new Map<string, TS.IScriptSnapshot>();
  const host: TS.LanguageServiceHost = {
    getCompilationSettings: () => config.options,
    getScriptFileNames: () => config.rootNames,
    getProjectReferences: () => config.projectReferences,
    // Nothing changes while a check runs: every file is at its first version.
    getScriptVersion: () => "1",
    getScriptSnapshot: (fileName) => {
      let snapshot = snapshots.get(fileName);
      if (snapshot === undefined) {
        const text = fs.readFile(fileName);
        if (text === undefined) return undefined;
        snapshot = ts.ScriptSnapshot.fromString(text);
        snapshots.set(fileName, snapshot);
      }
      return snapshot;
    },
    getCurrentDirectory: () => PROJECT_ROOT,
    getDefaultLibFileName: (options) =>
      `${COMPILER_ROOT}/lib/${ts.getDefaultLibFileName(options)}`,
    fileExists: (path) => fs.fileExists(path),
    readFile: (path) => fs.readFile(path),
    directoryExists: (path) => fs.directoryExists(path),
    getDirectories: (path) => fs.getDirectories(path),
    realpath: (path) => fs.realpath(path),
    useCaseSensitiveFileNames: () => true,
  };
  return ts.createLanguageService(host, registry);
}

/**
 * The diagnostics `tsc --noEmit -p <config>` prints: the config's own, then
 * `getPreEmitDiagnostics` (options, global, syntactic, semantic, and
 * declaration ones when the config emits declarations), sorted and
 * deduplicated as `tsc` does.
 */
function diagnosticsOf(
  ts: TypeScript,
  program: TS.Program,
  config: ProjectConfig,
): TypeErrorEntry[] {
  const all = ts.sortAndDeduplicateDiagnostics([
    ...config.errors,
    ...ts.getPreEmitDiagnostics(program),
  ]);
  return all
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d): TypeErrorEntry => {
      const position =
        d.file && d.start !== undefined
          ? d.file.getLineAndCharacterOfPosition(d.start)
          : null;
      return {
        file: d.file ? relative(d.file.fileName) : null,
        line: position ? position.line + 1 : null,
        column: position ? position.character + 1 : null,
        code: d.code,
        message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
        tsconfig: relative(config.path),
      };
    });
}

/**
 * Compilers already evaluated, by version: a worker that checks the base and
 * then the upgrade evaluates 9 MB of `typescript.js` once.
 */
const evaluated = new Map<string, TypeScript>();

const elapsed = (since: number) => Math.round(performance.now() - since);

/** Each workspace project's package name, which the hoist needs and the lockfile lacks. */
function workspaceNamesOf(
  lockfile: PnpmLockfile,
  files: Record<string, string>,
): Record<string, string> {
  const names: Record<string, string> = {};
  for (const id of Object.keys(lockfile.importers)) {
    const text = files[id === "." ? "package.json" : `${id}/package.json`];
    if (text === undefined) continue;
    try {
      const manifest: unknown = JSON.parse(text);
      if (isRecord(manifest) && typeof manifest["name"] === "string") {
        names[id] = manifest["name"];
      }
    } catch {
      // A package.json that is not JSON has no name to hoist; the
      // typecheck itself reports it if anything reads it.
    }
  }
  return names;
}

export function layoutOf(input: {
  lockfile: string;
  workspace?: string | null;
  files: Record<string, string>;
}): { lockfile: PnpmLockfile; layout: PnpmLayout } {
  const lockfile = parsePnpmLockfile(input.lockfile);
  const workspace: unknown = input.workspace ? parse(input.workspace) : {};
  const layout = computePnpmLayout(lockfile, {
    ...layoutOptionsOfWorkspace(isRecord(workspace) ? workspace : {}),
    root: PROJECT_ROOT,
    workspaceNames: workspaceNamesOf(lockfile, input.files),
  });
  return { lockfile, layout };
}

/** Typechecks a project as it would be after `pnpm install`. */
export async function typecheckProject(
  input: TypecheckInput,
): Promise<TypecheckResult> {
  const started = performance.now();
  const progress = input.onProgress ?? (() => {});

  progress({ step: "layout" });
  const layoutStarted = performance.now();
  const { layout } = layoutOf(input);
  const layoutMs = elapsed(layoutStarted);

  const compilerStarted = performance.now();
  const wanted = typescriptVersion(input.lockfile);
  let choice = chooseCompiler(wanted);
  progress({ step: "compiler", version: choice.version });
  let compiler: CompilerBundle;
  try {
    compiler = await input.sources.compiler(choice.version);
  } catch (error) {
    // adept knows which versions have no JavaScript compiler better than a
    // version number does: a 7 prerelease, say.
    if (
      !(error instanceof SourceError) ||
      error.code !== "no-js-compiler" ||
      choice.reason !== "project"
    ) {
      throw error;
    }
    choice = { version: BUNDLED_TYPESCRIPT, wanted, reason: "no-js-compiler" };
    progress({ step: "compiler", version: choice.version });
    compiler = await input.sources.compiler(choice.version);
  }
  const source = compiler.files["lib/typescript.js"];
  if (source === undefined) {
    throw new SourceError(
      `adept's TypeScript ${choice.version} came without lib/typescript.js.`,
      "unexpected-answer",
      false,
    );
  }
  let ts = evaluated.get(choice.version);
  if (ts === undefined) {
    ts = evaluateTypeScript(source);
    evaluated.set(choice.version, ts);
  }
  const compilerMs = elapsed(compilerStarted);

  const fs = new LinkedFileSystem(layout.links);
  for (const [path, text] of Object.entries(compiler.files)) {
    if (path.startsWith("lib/") && path.endsWith(".d.ts")) {
      fs.writeFile(`${COMPILER_ROOT}/${path}`, text);
    }
  }
  const projectFiles: string[] = [];
  for (const [path, text] of Object.entries(input.files)) {
    const absolute = normalizePath(`${PROJECT_ROOT}/${path}`);
    if (absolute.includes("/node_modules/")) continue;
    fs.writeFile(absolute, text);
    projectFiles.push(absolute);
  }

  const typesStarted = performance.now();
  const configs = readConfigs(ts, fs, projectFiles);
  const acquisition = new TypeAcquisition(ts, fs, layout, input.sources);
  const reportFetching = () =>
    progress({
      step: "types",
      fetched: acquisition.stats.scanned + acquisition.stats.resolved,
    });
  for (const config of configs) {
    const dir = parentOf(config.path);
    for (const name of config.rootNames) {
      const text = fs.readFile(name);
      if (text !== undefined) acquisition.wantImportsOf(name, text);
    }
    for (const types of config.options.types ?? []) {
      acquisition.wantSpecifier(dir, types);
    }
    const jsxSource = config.options.jsxImportSource;
    if (jsxSource) acquisition.wantSpecifier(dir, `${jsxSource}/jsx-runtime`);
  }
  reportFetching();
  await acquisition.settle();

  /*
   * The scan finds what the imports name. TypeScript also looks where no
   * import says: `@types` for an untyped package, `typeRoots`, a package's
   * `typesVersions` and peers. So the programs are built, every package
   * TypeScript looked in and that is not fetched yet is fetched, and again,
   * until a round looks nowhere new.
   */
  const registry = ts.createDocumentRegistry(true, PROJECT_ROOT);
  let rounds = 0;
  for (; rounds < MAX_RESOLUTION_ROUNDS; rounds++) {
    const looked = new Set<string>();
    fs.onLookup = (real) => {
      const dir = packageDirOf(real);
      if (dir !== null && !acquisition.has(dir) && acquisition.packageAt(dir)) {
        looked.add(dir);
      }
    };
    for (const config of configs) {
      languageServiceFor(ts, fs, config, registry).getProgram();
    }
    fs.onLookup = null;
    if (looked.size === 0) break;
    for (const dir of looked) acquisition.wantPackage(dir, "resolved");
    reportFetching();
    await acquisition.settle();
  }
  const typesMs = elapsed(typesStarted);

  const checkStarted = performance.now();
  const errors: TypeErrorEntry[] = [];
  const programs: ProgramSummary[] = [];
  for (const config of configs) {
    progress({ step: "check", tsconfig: relative(config.path) });
    const service = languageServiceFor(ts, fs, config, registry);
    const program = service.getProgram();
    if (!program) continue;
    const found = diagnosticsOf(ts, program, config);
    errors.push(...found);
    const sourceFiles = program.getSourceFiles();
    programs.push({
      tsconfig: relative(config.path),
      files: sourceFiles.length,
      errors: found.length,
      ...(input.listFiles
        ? { fileNames: sourceFiles.map((file) => relative(file.fileName)) }
        : {}),
    });
    service.dispose();
  }
  const checkMs = elapsed(checkStarted);

  const { stats } = acquisition;
  return {
    errors,
    programs,
    typescript: choice,
    bundles: { ...stats, count: stats.scanned + stats.resolved, rounds },
    missing: acquisition.missing,
    timings: {
      layoutMs,
      compilerMs,
      typesMs,
      checkMs,
      totalMs: elapsed(started),
    },
  };
}

const errorKey = (error: TypeErrorEntry) =>
  `${error.file ?? ""}\0${error.code}\0${error.message}`;

/**
 * The errors of `next` that `base` does not have (decision 20): an upgrade
 * is judged only by the errors it adds. Errors are matched by file, code and
 * message, not by position, so that an error which only moved is not new;
 * and counted, so that a second copy of an error the base has once is.
 */
export function newErrors(
  base: TypeErrorEntry[],
  next: TypeErrorEntry[],
): TypeErrorEntry[] {
  const remaining = new Map<string, number>();
  for (const error of base) {
    const key = errorKey(error);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  return next.filter((error) => {
    const key = errorKey(error);
    const left = remaining.get(key) ?? 0;
    if (left === 0) return true;
    remaining.set(key, left - 1);
    return false;
  });
}
