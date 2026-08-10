import path from "path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import type { ValModules } from "@valbuild/core";
import { getCompilerOptions } from "./getCompilerOptions";
import { IValFSHost } from "./ValFSHost";

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
 * All project file reads / existence checks go through `host`, so a custom
 * `IValFSHost` (virtual FS, patched reads, ...) is respected. Only actual
 * `node_modules` packages bypass it, since those must be the same instances
 * the server itself is running.
 *
 * Mirrors the pattern already used by the CLI's `evalValConfigFile`.
 */
export function loadValModules(
  projectRoot: string,
  host: IValFSHost,
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
  host: IValFSHost,
): string | null {
  for (const fileName of ["val.modules.ts", "val.modules.js"]) {
    const candidate = path.join(projectRoot, fileName);
    if (host.fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs"];

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
  host: IValFSHost,
): { exports: Record<string, unknown> } {
  const cached = cache[absPath];
  if (cached) {
    return cached;
  }
  const code = host.readFile(absPath);
  if (code === undefined) {
    throw Error(`Could not read file: '${absPath}'`);
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
  const realRequire = createRequire(absPath);
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
  host: IValFSHost,
): string | null {
  const base = path.resolve(dirName, spec);
  // Exact file (with extension). fileExists is false for directories, so this
  // does not shadow the directory-index probe below.
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
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = path.join(base, "index" + ext);
    if (host.fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}
