import path from "path";
import ts from "typescript";
import { getCompilerOptions } from "./getCompilerOptions";
import type { IValFSHost } from "./ValFSHost";

const JsFileLookupMapping: [resolvedFileExt: string, replacements: string[]][] =
  [
    // NOTE: first one matching will be used
    [".cjs.d.ts", [".esm.js", ".mjs.js"]],
    [".cjs.js", [".esm.js", ".mjs.js"]],
    [".cjs", [".mjs"]],
    [".d.ts", [".js"]],
  ];

export class ValModuleResolver {
  public readonly compilerOptions: ts.CompilerOptions;

  constructor(
    public readonly projectRoot: string,
    private readonly host: IValFSHost = ts.sys
  ) {
    this.compilerOptions = getCompilerOptions(projectRoot, host);
  }

  getTranspiledCode(modulePath: string): string {
    if (!modulePath) {
      throw Error(`Illegal module path: "${modulePath}"`);
    }
    const code = this.host.readFile(modulePath);
    if (!code) {
      throw Error(`Could not read file "${modulePath}"`);
    }
    return ts.transpile(code, {
      ...this.compilerOptions,
      // allowJs: true,
      // rootDir: this.compilerOptions.rootDir,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020, // QuickJS supports a lot of ES2020: https://test262.report/, however not all cases are in that report (e.g. export const {} = {})
      // moduleResolution: ts.ModuleResolutionKind.NodeNext,
      // target: ts.ScriptTarget.ES2020, // QuickJs runs in ES2020 so we must use that
    });
  }

  resolveSourceModulePath(
    containingFilePath: string,
    requestedModuleName: string
  ): string {
    const resolutionRes = ts.resolveModuleName(
      requestedModuleName,
      path.isAbsolute(containingFilePath)
        ? containingFilePath
        : path.resolve(this.projectRoot, containingFilePath),
      this.compilerOptions,
      this.host,
      undefined,
      undefined,
      ts.ModuleKind.ESNext
    );
    const resolvedModule = resolutionRes.resolvedModule;
    if (!resolvedModule) {
      throw Error(
        `Could not resolve module "${requestedModuleName}", base: "${containingFilePath}": No resolved modules returned: ${JSON.stringify(
          resolutionRes
        )}`
      );
    }
    return resolvedModule.resolvedFileName;
  }

  resolveRuntimeModulePath(
    containingFilePath: string,
    requestedModuleName: string
  ): string {
    const sourceFileName = this.resolveSourceModulePath(
      containingFilePath,
      requestedModuleName
    );
    const matches = this.findMatchingJsFile(sourceFileName);
    if (matches.match === false) {
      throw Error(
        `Could not find matching js file for module "${requestedModuleName}". Tried:\n${matches.tried.join(
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
