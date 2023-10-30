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

export class ValModuleLoader {
  constructor(
    public readonly projectRoot: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private readonly compilerOptions: ts.CompilerOptions,
    private readonly sourceFileHandler: ValSourceFileHandler,
    private readonly host: IValFSHost = {
      ...ts.sys,
      writeFile: fs.writeFileSync,
    }
  ) {}

  getModule(modulePath: string): string {
    if (!modulePath) {
      throw Error(`Illegal module path: "${modulePath}"`);
    }
    const code = this.host.readFile(modulePath);
    if (!code) {
      throw Error(`Could not read file "${modulePath}"`);
    }

    const compiledCode = transform(code, {
      filePath: modulePath,
      disableESTransforms: true,
      transforms: ["typescript"],
    }).code;
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
