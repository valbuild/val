import path from "path";
import ts from "typescript";
import glob from "glob";

const JsFileLookupMapping: [resolvedFileExt: string, replacements: string[]][] =
  [
    // NOTE: first one matching will be used
    [".cjs.d.ts", [".esm.js", ".mjs.js"]],
    [".cjs.js", [".esm.js", ".mjs.js"]],
    [".cjs", [".mjs"]],
    [".d.ts", [".js"]],
  ];

export class ValModuleResolver {
  private readonly compilerHost: ts.CompilerHost;
  private readonly compilerOptions: ts.CompilerOptions;
  readonly projectRoot: string;

  private getCompilerOptions(rootDir: string): ts.CompilerOptions {
    const parseConfigHost: ts.ParseConfigHost = ts.sys;
    const tsConfigPath = path.resolve(rootDir, "tsconfig.json");
    const jsConfigPath = path.resolve(rootDir, "jsconfig.json");
    let configFilePath: string;
    if (parseConfigHost.fileExists(jsConfigPath)) {
      configFilePath = jsConfigPath;
    } else if (parseConfigHost.fileExists(tsConfigPath)) {
      configFilePath = tsConfigPath;
    } else {
      throw Error(
        `Could not read config from: "${tsConfigPath}" nor "${jsConfigPath}". Root dir: "${rootDir}"`
      );
    }
    const { config, error } = ts.readConfigFile(
      configFilePath,
      parseConfigHost.readFile
    );
    if (error) {
      if (typeof error.messageText === "string") {
        throw Error(
          `Could not parse config file: ${configFilePath}. Error: ${error.messageText}`
        );
      }
      throw Error(
        `Could not parse config file: ${configFilePath}. Error: ${error.messageText.messageText}`
      );
    }
    const optionsOverrides = undefined;
    const parsedConfigFile = ts.parseJsonConfigFileContent(
      config,
      parseConfigHost,
      rootDir,
      optionsOverrides,
      configFilePath
    );
    if (parsedConfigFile.errors.length > 0) {
      throw Error(
        `Could not parse config file: ${configFilePath}. Errors: ${parsedConfigFile.errors
          .map((e) => e.messageText)
          .join("\n")}`
      );
    }
    return parsedConfigFile.options;
  }

  constructor(currentDir: string) {
    this.projectRoot = currentDir;
    this.compilerOptions = this.getCompilerOptions(currentDir);
    this.compilerHost = ts.createCompilerHost(this.compilerOptions);
  }

  getTranspiledCode(modulePath: string): string {
    // TODO: consider using compilerHost instead of fs below:
    const code = this.compilerHost.readFile(modulePath);
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
      this.compilerHost,
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
    return this.compilerHost.realpath
      ? this.compilerHost.realpath(filePath)
      : filePath;
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
      if (this.compilerHost.fileExists(filePath)) {
        return { match: filePath };
      }
    }
    const tried = [];
    for (const [currentEnding, replacements] of JsFileLookupMapping) {
      if (filePath.endsWith(currentEnding)) {
        for (const replacement of replacements) {
          const newFilePath =
            filePath.slice(0, -currentEnding.length) + replacement;
          if (this.compilerHost.fileExists(newFilePath)) {
            return { match: newFilePath };
          } else {
            tried.push(newFilePath);
          }
        }
      }
    }

    return { match: false, tried: tried.concat(filePath) };
  }

  getSourceFile(filePath: string): ts.SourceFile | undefined {
    return this.compilerHost.getSourceFile(filePath, ts.ScriptTarget.ES2020);
  }

  writeSourceFile(sourceFile: ts.SourceFile) {
    this.compilerHost.writeFile(
      sourceFile.fileName,
      sourceFile.text,
      false,
      undefined,
      [sourceFile]
    );
  }

  getValModulePaths(configPath: string): string[] {
    return glob.sync(
      `${path.dirname(path.join(this.projectRoot, configPath))}/**/*.val.[jt]s`
    );
  }
}
