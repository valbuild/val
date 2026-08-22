import path from "path";
import fs from "fs";
import vm from "node:vm";
import { Module } from "node:module";
import ts from "typescript";
import type { ValModules } from "@valbuild/core";
import { getCompilerOptions } from "./getCompilerOptions";

/**
 * The filesystem seam `loadValModules` reads through.
 *
 * Defaults to `ts.sys`, i.e. the real filesystem. An editor integration (see
 * `@valbuild/language-server`) passes a host that overlays unsaved buffers, so
 * that evaluation sees what the user is looking at rather than what was last
 * saved.
 */
export type ValModulesHost = ts.ParseConfigHost & ts.ModuleResolutionHost;

/**
 * Loads the project's root `val.modules.ts` (or `.js`) using Node's `vm`
 * module and returns its default export (a `ValModules` registry).
 *
 * This is a recursive CommonJS loader: the root modules file and every
 * relative `*.val.ts` / `val.config.ts` it (dynamically) imports are
 * transpiled to CommonJS and evaluated in a `vm` sandbox. Bare specifiers
 * (e.g. `@valbuild/core`) are resolved with the real Node `require` so the
 * user modules share the exact same `@valbuild/core` instance that
 * `extractValModules` uses.
 *
 * Mirrors the pattern already used by the CLI's `evalValConfigFile`.
 *
 * SECURITY: The `vm` context is NOT a security sandbox. It deliberately exposes
 * `process` and a `require` that falls back to the real Node resolver (so user
 * modules share the same `@valbuild/core` instance). This loader must therefore
 * only ever be used to evaluate the project's own first-party, trusted files
 * (`val.modules` and the local `*.val.ts`/`val.config.ts` it imports) — i.e. the
 * same trust level as running the project's build. It must never be used to
 * evaluate untrusted or third-party modules.
 */
export function loadValModules(
  projectRoot: string,
  host: ValModulesHost = ts.sys,
): ValModules {
  const valModulesPath = findValModulesPath(projectRoot, host);
  if (!valModulesPath) {
    throw Error(
      `Could not find 'val.modules.ts' nor 'val.modules.js' in project root: '${projectRoot}'`,
    );
  }
  const compilerOptions = getCompilerOptions(projectRoot, host);
  const cache: Record<string, { exports: Record<string, unknown> }> = {};
  const loaded = loadModule(valModulesPath, cache, compilerOptions, host);
  const valModules = loaded.exports.default;
  if (!valModules) {
    throw Error(
      `Val modules file at path: '${valModulesPath}' must have a default export. Got: ${valModules}`,
    );
  }
  return valModules as ValModules;
}

function findValModulesPath(
  projectRoot: string,
  host: ValModulesHost,
): string | null {
  for (const fileName of ["val.modules.ts", "val.modules.js"]) {
    const candidate = path.join(projectRoot, fileName);
    if (host.fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

const RESOLVE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".cjs",
  ".mjs",
  ".json",
];

// Specifiers that user val files must not actually use. We stub them so that
// importing is fine, but using a value throws a clear error. Real @valbuild
// packages are resolved via the real require, so when they (legitimately)
// import react/next internally those go through Node, not this stub.
function isStubbedSpecifier(spec: string): boolean {
  return (
    spec === "react" ||
    spec.startsWith("react/") ||
    spec === "next" ||
    spec.startsWith("next/") ||
    spec === "@valbuild/ui" ||
    spec === "@valbuild/react" ||
    spec.startsWith("@valbuild/react/")
  );
}

function makeStub(spec: string): Record<string, unknown> {
  const throwing = (prop: string) => () => {
    throw Error(`Cannot use '${prop}' from '${spec}' in this type of file`);
  };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === "__esModule") {
        return true;
      }
      if (typeof prop === "symbol") {
        return undefined;
      }
      // React.createContext is sometimes called at module top-level; return a
      // proxy-returning function so evaluation does not crash on import.
      if (prop === "createContext") {
        return () => new Proxy({}, handler);
      }
      if (prop === "default") {
        return stub;
      }
      return throwing(prop);
    },
  };
  const stub = new Proxy({}, handler);
  return stub;
}

function loadModule(
  absPath: string,
  cache: Record<string, { exports: Record<string, unknown> }>,
  compilerOptions: ts.CompilerOptions,
  host: ValModulesHost,
): { exports: Record<string, unknown> } {
  const cached = cache[absPath];
  if (cached) {
    return cached;
  }
  // JSON modules (e.g. the `*.val.json` files backing `.jsonValues()` entries)
  // are loaded by parsing, mirroring Node's `require("./x.json")` which returns
  // the parsed object as `module.exports`. The importing `.val.ts` wraps this
  // with `__importStar` so `import("./x.val.json")` yields `{ default, ... }`.
  // These are only loaded when an entry thunk is invoked, never during
  // `extractValModules`, so this stays lazy.
  //
  // Read through `host` like every other project file: an editor integration
  // passes a host that overlays unsaved buffers, and an entry the user is
  // editing has to resolve to what they are looking at.
  if (absPath.endsWith(".json")) {
    const json = host.readFile(absPath);
    if (json === undefined) {
      throw Error(`Could not read Val module file: '${absPath}'`);
    }
    const jsonModule = { exports: JSON.parse(json) as Record<string, unknown> };
    cache[absPath] = jsonModule;
    return jsonModule;
  }
  const code = host.readFile(absPath);
  if (code === undefined) {
    throw Error(`Could not read Val module file: '${absPath}'`);
  }
  const transpiled = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: absPath,
  });

  const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
  // Insert into the cache before evaluating so cyclic imports resolve.
  cache[absPath] = moduleObj;

  const dirName = path.dirname(absPath);
  const realRequire = Module.createRequire(absPath);
  const customRequire = (spec: string): unknown => {
    if (isStubbedSpecifier(spec)) {
      return makeStub(spec);
    }
    if (spec.startsWith(".") || path.isAbsolute(spec)) {
      const resolved = resolveRelative(dirName, spec, host);
      if (!resolved) {
        throw Error(`Could not resolve module '${spec}' from '${absPath}'`);
      }
      return loadModule(resolved, cache, compilerOptions, host).exports;
    }
    // Non-relative specifier: it might be a tsconfig path alias (e.g. "_/val.config")
    // pointing at a local source file, or an actual node_modules package.
    const tsResolved = ts.resolveModuleName(
      spec,
      absPath,
      compilerOptions,
      host,
    ).resolvedModule?.resolvedFileName;
    if (
      tsResolved &&
      !tsResolved.includes("/node_modules/") &&
      !tsResolved.endsWith(".d.ts")
    ) {
      return loadModule(tsResolved, cache, compilerOptions, host).exports;
    }
    // Real node_modules package – use the real require so user modules share
    // the same @valbuild/core instance as extractValModules.
    return realRequire(spec);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sandbox: Record<string, any> = {
    exports: moduleObj.exports,
    module: moduleObj,
    require: customRequire,
    __filename: absPath,
    __dirname: dirName,
    console,
    process,
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  const script = new vm.Script(transpiled.outputText, { filename: absPath });
  script.runInContext(context);

  return moduleObj;
}

function resolveRelative(
  dirName: string,
  spec: string,
  host: ValModulesHost,
): string | null {
  const base = path.resolve(dirName, spec);
  // Exact file (with extension)
  if (host.fileExists(base)) {
    return base;
  }
  // Probe extensions (handles `./x.val` -> `./x.val.ts`)
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = base + ext;
    if (host.fileExists(candidate)) {
      return candidate;
    }
  }
  // Directory index
  if (host.directoryExists?.(base) ?? fs.existsSync(base)) {
    for (const ext of RESOLVE_EXTENSIONS) {
      const candidate = path.join(base, "index" + ext);
      if (host.fileExists(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}
