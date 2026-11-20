// @ts-check
import fs from "fs";
import path from "path";
import ts from "typescript";
import { registeredSpecifiers } from "./projectHost";

/**
 * The project, read from the disk: what the rules have always done in an
 * editor and in `eslint .`. See `projectHost.js`.
 */

/**
 * Read a tsconfig/jsconfig, comments and all.
 *
 * `JSON.parse` is not enough: a tsconfig is JSONC, and plenty of templates ship
 * with comments in it — the TanStack Start starter does — so this rule threw
 * `Expected double-quoted property name in JSON` on the FIRST file of such a
 * project and took the whole lint run with it. `parseConfigFileTextToJson` is
 * the parser tsc itself uses; a file it still cannot read yields `{}`, which
 * leaves the resolution defaults in place rather than failing the run.
 *
 * @param {string} configPath
 * @returns {{ compilerOptions?: ts.CompilerOptions & { baseUrl?: string, paths?: Record<string, string[]> } }}
 */
function readConfigFile(configPath) {
  try {
    const { config, error } = ts.parseConfigFileTextToJson(
      configPath,
      fs.readFileSync(configPath, "utf-8"),
    );
    return error ? {} : config || {};
  } catch {
    return {};
  }
}

/** @type {Record<string, ts.ModuleResolutionCache>} */
const resolutionCache = {};

/**
 * @type {Record<string, string>}
 */
const PACKAGE_JSON_DIRS_CACHE = {}; // we cache to avoid having to do as many fs operations. however, it will fail if the user moves package.json / root directories. For now, we accept that bug since performance is considered more important. Maybe there is a way to know when that happens so we avoid those bugs.

/** @type {import("./projectHost").ValProjectHost} */
export const nodeHost = {
  modulePathOf(filename, cwd) {
    let packageJsonDir = PACKAGE_JSON_DIRS_CACHE[path.dirname(filename)];
    if (!packageJsonDir) {
      const runtimeRoot = path.resolve(cwd);
      packageJsonDir = path.resolve(path.dirname(filename));
      while (
        !fs.existsSync(path.join(packageJsonDir, "package.json")) &&
        packageJsonDir !== runtimeRoot
      ) {
        packageJsonDir = path.dirname(packageJsonDir);
      }
      PACKAGE_JSON_DIRS_CACHE[path.dirname(filename)] = packageJsonDir;
    }
    return `/${path.relative(packageJsonDir, filename)}`;
  },

  registeredModules(cwd) {
    const projectDir = path.resolve(cwd);
    const modulesFilePath = path.join(projectDir, "val.modules.ts");

    let baseUrl = projectDir;
    /** @type { {[key: string]: string[];} } */
    let paths = {};
    let cacheKey = baseUrl;

    const tsConfigPath = ts.findConfigFile(
      projectDir,
      ts.sys.fileExists,
      "tsconfig.json",
    );
    const jsConfigPath = ts.findConfigFile(
      projectDir,
      ts.sys.fileExists,
      "jsconfig.json",
    );

    if (tsConfigPath) {
      const tsConfig = readConfigFile(tsConfigPath);

      baseUrl = tsConfig.compilerOptions?.baseUrl
        ? path.resolve(projectDir, tsConfig.compilerOptions.baseUrl)
        : projectDir;
      paths = tsConfig.compilerOptions?.paths || {};
      cacheKey = baseUrl + "/tsconfig.json";
      if (!resolutionCache[cacheKey]) {
        resolutionCache[cacheKey] = ts.createModuleResolutionCache(
          baseUrl,
          (x) => x,
          tsConfig.compilerOptions,
        );
      }
    } else if (jsConfigPath) {
      const jsConfig = readConfigFile(jsConfigPath);

      baseUrl = jsConfig.compilerOptions?.baseUrl
        ? path.resolve(projectDir, jsConfig.compilerOptions.baseUrl)
        : projectDir;
      paths = jsConfig.compilerOptions?.paths || {};
      cacheKey = baseUrl + "/jsconfig.json";
      if (!resolutionCache[cacheKey]) {
        resolutionCache[cacheKey] = ts.createModuleResolutionCache(
          baseUrl,
          (x) => x,
          jsConfig.compilerOptions,
        );
      }
    }

    // Function to resolve import paths
    const resolvePath = (/** @type {string} */ importPath) => {
      // Attempt to resolve using TypeScript path mapping
      const resolvedModule = ts.resolveModuleName(
        importPath,
        path.join(baseUrl, "val.modules.ts"),
        {
          baseUrl,
          paths,
        },
        ts.sys,
        resolutionCache[cacheKey],
      );
      const resolved = resolvedModule.resolvedModule?.resolvedFileName;
      if (resolved) {
        return path.resolve(resolved);
      }
      // Fallback to Node.js resolution
      try {
        return require.resolve(importPath, { paths: [projectDir] });
      } catch {
        return undefined;
      }
    };

    if (!fs.existsSync(modulesFilePath)) {
      return null;
    }

    return registeredSpecifiers(fs.readFileSync(modulesFilePath, "utf-8"))
      .map(resolvePath)
      .filter((file) => file !== undefined);
  },

  displayPath(filename, cwd) {
    return filename.replace(path.resolve(cwd), "");
  },
};
