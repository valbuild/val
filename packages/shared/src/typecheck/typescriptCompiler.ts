import type * as TS from "typescript";

/** The TypeScript API, from whichever `typescript.js` was loaded. */
export type TypeScript = typeof TS;

/** adept's `/compiler/<version>`: `lib/typescript.js` and every `lib/lib.*.d.ts`. */
export type CompilerBundle = { version: string; files: Record<string, string> };

/**
 * The TypeScript a project gets when its own cannot run here.
 *
 * TypeScript 7 and later are a native compiler with no JavaScript one
 * (`lib/typescript.js`), so they cannot run in a browser; a project with no
 * `typescript` at all has none to choose. Both are checked with this 6.x,
 * the one the Studio itself is built and tested with
 * (`typescriptCompiler.test.ts` keeps the two the same). It is fetched from
 * adept like any other, rather than shipped in the Studio's bundle, which is
 * embedded in every Val server.
 */
export const BUNDLED_TYPESCRIPT = "6.0.3";

/** Which TypeScript checks a project, and why that one. */
export type CompilerChoice = {
  version: string;
  /** What the root importer's lockfile entry gives, if anything. */
  wanted: string | null;
  reason: "project" | "no-typescript" | "no-js-compiler";
};

export function chooseCompiler(wanted: string | null): CompilerChoice {
  if (wanted === null) {
    return { version: BUNDLED_TYPESCRIPT, wanted, reason: "no-typescript" };
  }
  const major = Number(/^(\d+)\./.exec(wanted)?.[1] ?? NaN);
  if (major >= 7) {
    return { version: BUNDLED_TYPESCRIPT, wanted, reason: "no-js-compiler" };
  }
  return { version: wanted, wanted, reason: "project" };
}

/**
 * Whether `value` is the TypeScript API. Checked by the functions this
 * typechecker calls, which every version since 4 has.
 */
function isTypeScript(value: unknown): value is TypeScript {
  if (typeof value !== "object" || value === null) return false;
  return [
    "createLanguageService",
    "createDocumentRegistry",
    "parseJsonConfigFileContent",
    "readConfigFile",
    "preProcessFile",
    "getPreEmitDiagnostics",
    "flattenDiagnosticMessageText",
    "getDefaultLibFileName",
    "sortAndDeduplicateDiagnostics",
  ].every((name) => typeof Reflect.get(value, name) === "function");
}

/** A TypeScript that does not have what a typecheck needs. */
export class CompilerError extends Error {}

/**
 * Evaluates `lib/typescript.js` and returns its API.
 *
 * It is a CommonJS module that also runs as a plain script, so it is given a
 * `module` to assign to. `require` and `process` are given as `undefined`,
 * as they are in a worker, so that it does not build a Node `ts.sys` when it
 * runs under Node: everything it reads goes through the host this
 * typechecker gives it.
 */
export function evaluateTypeScript(source: string): TypeScript {
  const module: { exports: unknown } = { exports: {} };
  // The compiler is text fetched at run time: evaluating it is the point.
  const run = new Function(
    "module",
    "exports",
    "require",
    "process",
    "__filename",
    "__dirname",
    source,
  );
  run(module, module.exports, undefined, undefined, undefined, undefined);
  if (!isTypeScript(module.exports)) {
    throw new CompilerError(
      "lib/typescript.js did not give the TypeScript API this typecheck needs.",
    );
  }
  return module.exports;
}

/**
 * `ts.matchFiles`, which is how `tsc` expands a tsconfig's `include` and
 * `exclude`. It is internal, but every `typescript.js` since 2.x has it on
 * its API object, and using it is the only way to agree with `tsc` on hidden
 * files, `node_modules` and implicit directory globs.
 */
export type MatchFiles = (
  path: string,
  extensions: readonly string[] | undefined,
  excludes: readonly string[] | undefined,
  includes: readonly string[] | undefined,
  useCaseSensitiveFileNames: boolean,
  currentDirectory: string,
  depth: number | undefined,
  getFileSystemEntries: (path: string) => {
    files: readonly string[];
    directories: readonly string[];
  },
  realpath: (path: string) => string,
) => string[];

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

export function matchFilesOf(ts: TypeScript): MatchFiles {
  const internal: unknown = Reflect.get(ts, "matchFiles");
  if (typeof internal !== "function") {
    throw new CompilerError(
      `TypeScript ${ts.version} has no matchFiles, so its tsconfig include patterns cannot be read here.`,
    );
  }
  return (...args) => {
    const files: unknown = Reflect.apply(internal, ts, args);
    if (!isStringArray(files)) {
      throw new CompilerError(
        `TypeScript ${ts.version}'s matchFiles did not answer with file names.`,
      );
    }
    return files;
  };
}
