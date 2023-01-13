import path from "path";
import fs, { promises } from "fs";
import * as ts from "typescript";

export interface ValModuleResolver {
  getTranspiledCode: (modulePath: string) => Promise<string>;
  resolveModulePath(
    containingFilePath: string,
    requestedModuleName: string
  ): string;
}

export class ValFileSystemModuleResolver implements ValModuleResolver {
  private readonly compilerHost: ts.CompilerHost;

  private static readonly compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ES2020,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  };
  constructor(private readonly rootDir: string) {
    this.compilerHost = ts.createCompilerHost({
      rootDir,
      ...ValFileSystemModuleResolver.compilerOptions,
    });
  }

  async getTranspiledCode(modulePath: string): Promise<string> {
    const code = await promises.readFile(modulePath, "utf-8");
    return ts.transpile(code, {
      allowJs: true,
      module: ts.ModuleKind.ES2020,
    });
  }

  resolveModulePath(
    containingFilePath: string,
    requestedModuleName: string
  ): string {
    const { resolvedModule } = ts.resolveModuleName(
      requestedModuleName,
      path.resolve(this.rootDir, containingFilePath),
      ValFileSystemModuleResolver.compilerOptions,
      this.compilerHost
    );

    if (!resolvedModule) {
      throw Error(
        `Could not resolve module "${requestedModuleName}", base: "${path.resolve(
          this.rootDir,
          containingFilePath
        )}": No resolved modules returned`
      );
    }
    const resolvedFileName = resolvedModule.resolvedFileName;
    if (!resolvedFileName) {
      throw Error(
        `Could not resolve module "${requestedModuleName}", base: "${containingFilePath}": No resolved file name returned`
      );
    }
    const modulePath = resolvedFileName;
    let filePath = modulePath;

    if (filePath.endsWith(".d.ts")) {
      const jsFilePath = filePath.replace(/\.d.ts$/, ".js");
      if (fs.existsSync(jsFilePath)) {
        filePath = filePath.replace(/\.d.ts$/, ".js");
      }
    }
    // TODO: get module resolution to resolve esm not cjs
    if (filePath.endsWith(".cjs.js")) {
      const esmFilePath = filePath.replace(/\.cjs.js$/, ".esm.js");
      if (fs.existsSync(esmFilePath)) {
        filePath = esmFilePath;
      }
    } else if (filePath.endsWith(".cjs")) {
      const esmFilePath = filePath.replace(/.cjs$/, ".esm");
      if (fs.existsSync(esmFilePath)) {
        filePath = filePath.replace(/.cjs$/, ".esm");
      }
    }

    // resolve all symlinks (preconstruct for example symlinks the dist folder)
    filePath = fs.realpathSync(filePath);
    return filePath;
  }
}
