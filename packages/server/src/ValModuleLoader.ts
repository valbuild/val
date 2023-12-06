import ts from "typescript";
import { getCompilerOptions } from "./getCompilerOptions";
import type { IValFSHost } from "./ValFSHost";
import { ValSourceFileHandler } from "./ValSourceFileHandler";
import fs from "fs";
import { transform } from "sucrase";
const JsFileLookupMapping: [resolvedFileExt: string, replacements: string[]][] =
  [
    // NOTE: first one matching will be used
    [".cjs.d.ts", [".esm.js", ".mjs.js"]],
    [".cjs.js", [".esm.js", ".mjs.js"]],
    [".cjs", [".mjs"]],
    [".d.ts", [".js", ".esm.js", ".mjs.js"]],
  ];

export const createModuleLoader = (
  rootDir: string,
  host: IValFSHost = {
    ...ts.sys,
    writeFile: fs.writeFileSync,
  }
): ValModuleLoader => {
  const compilerOptions = getCompilerOptions(rootDir, host);
  const sourceFileHandler = new ValSourceFileHandler(
    rootDir,
    compilerOptions,
    host
  );
  const loader = new ValModuleLoader(
    rootDir,
    compilerOptions,
    sourceFileHandler,
    host
  );
  return loader;
};

const MAX_CACHE_SIZE = 10 * 1024 * 1024; // 10 mb
const MAX_OBJECT_KEY_SIZE = 2 ** 27; // https://stackoverflow.com/questions/13367391/is-there-a-limit-on-length-of-the-key-string-in-js-object

export class ValModuleLoader {
  private cache: Record<string, string>;
  private cacheSize: number;
  constructor(
    public readonly projectRoot: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private readonly compilerOptions: ts.CompilerOptions, // TODO: remove this?
    private readonly sourceFileHandler: ValSourceFileHandler,
    private readonly host: IValFSHost = {
      ...ts.sys,
      writeFile: fs.writeFileSync,
    },
    private readonly disableCache: boolean = false
  ) {
    this.cache = {};
    this.cacheSize = 0;
  }

  getModule(modulePath: string): string {
    if (!modulePath) {
      throw Error(`Illegal module path: "${modulePath}"`);
    }
    const code = this.host.readFile(modulePath);
    if (!code) {
      throw Error(`Could not read file "${modulePath}"`);
    }
    let compiledCode;
    if (this.cache[code] && !this.disableCache) {
      // TODO: use hash instead of code as key
      compiledCode = this.cache[code];
    } else {
      compiledCode = transform(code, {
        filePath: modulePath,
        disableESTransforms: true,
        transforms: ["typescript"],
      }).code;
      if (!this.disableCache) {
        if (this.cacheSize > MAX_CACHE_SIZE) {
          console.warn("Cache size exceeded, clearing cache");
          this.cache = {};
          this.cacheSize = 0;
        }
        if (code.length < MAX_OBJECT_KEY_SIZE) {
          this.cache[code] = compiledCode;
          this.cacheSize += code.length + compiledCode.length; // code is mostly ASCII so 1 byte per char
        }
      }
    }
    return compiledCode;
  }

  resolveModulePath(
    containingFilePath: string,
    requestedModuleName: string
  ): string {
    let sourceFileName = this.sourceFileHandler.resolveSourceModulePath(
      containingFilePath,
      requestedModuleName
    );

    if (requestedModuleName === "@vercel/stega") {
      sourceFileName = this.sourceFileHandler
        .resolveSourceModulePath(containingFilePath, "@vercel/stega")
        .replace("stega/dist", "stega/dist/esm");
    }
    const matches = this.findMatchingJsFile(sourceFileName);
    if (matches.match === false) {
      throw Error(
        `Could not find matching js file for module "${requestedModuleName}" requested by: "${containingFilePath}". Tried:\n${matches.tried.join(
          "\n"
        )}`
      );
    }
    const filePath = matches.match;
    // resolve all symlinks (preconstruct for example symlinks the dist folder)
    const followedPath = this.host.realpath?.(filePath) ?? filePath;
    if (!followedPath) {
      throw Error(
        `File path was empty: "${filePath}", containing file: "${containingFilePath}", requested module: "${requestedModuleName}"`
      );
    }
    return followedPath;
  }

  private findMatchingJsFile(
    filePath: string
  ): { match: string } | { match: false; tried: string[] } {
    let requiresReplacements = false;
    for (const [currentEnding] of JsFileLookupMapping) {
      if (filePath.endsWith(currentEnding)) {
        requiresReplacements = true;
        break;
      }
    }
    // avoid unnecessary calls to fileExists if we don't need to replace anything
    if (!requiresReplacements) {
      if (this.host.fileExists(filePath)) {
        return { match: filePath };
      }
    }
    const tried = [];
    for (const [currentEnding, replacements] of JsFileLookupMapping) {
      if (filePath.endsWith(currentEnding)) {
        for (const replacement of replacements) {
          const newFilePath =
            filePath.slice(0, -currentEnding.length) + replacement;
          if (this.host.fileExists(newFilePath)) {
            return { match: newFilePath };
          } else {
            tried.push(newFilePath);
          }
        }
      }
    }

    return { match: false, tried: tried.concat(filePath) };
  }
}
