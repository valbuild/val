import path from "path";
import ts from "typescript";

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
  private readonly projectRoot: string;

  private getCompilerOptions(rootDir: string): ts.CompilerOptions {
    const parseConfigHost: ts.ParseConfigHost = ts.sys;
    const tsConfigPath = path.resolve(rootDir, "tsconfig.json");
    const jsConfigPath = path.resolve(rootDir, "jsconfig.json");
    let configFilePath: string;
    if (parseConfigHost.readFile(jsConfigPath)) {
      configFilePath = jsConfigPath;
    } else if (parseConfigHost.readFile(tsConfigPath)) {
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
      target: ts.ScriptTarget.ES2020, // QuickJS claims to be a ES2020 compatible, but
      // moduleResolution: ts.ModuleResolutionKind.NodeNext,
      // target: ts.ScriptTarget.ES2020, // QuickJs runs in ES2020 so we must use that
    });
  }

  resolveModulePath(
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
    const resolvedFileName = resolvedModule.resolvedFileName;
    if (!resolvedFileName) {
      throw Error(
        `Could not resolve module "${requestedModuleName}", base: "${containingFilePath}"": No file name returned.`
      );
    }
    const matches = this.findMatchingJsFile(resolvedFileName);
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
    if (this.compilerHost.fileExists(filePath)) {
      return { match: filePath };
    }
    return { match: false, tried };
  }
}
