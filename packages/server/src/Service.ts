import { newQuickJSWASMModule, QuickJSRuntime } from "quickjs-emscripten";
import { patchValFile } from "./patchValFile";
import { readValFile } from "./readValFile";
import { Patch } from "@valbuild/core/patch";
import { ValModuleLoader } from "./ValModuleLoader";
import { newValQuickJSRuntime } from "./ValQuickJSRuntime";
import { ValSourceFileHandler } from "./ValSourceFileHandler";
import ts from "typescript";
import { getCompilerOptions } from "./getCompilerOptions";
import { IValFSHost } from "./ValFSHost";
import fs from "fs";
import { SerializedModuleContent } from "./SerializedModuleContent";
import {
  ModuleId,
  ModulePath,
  Internal,
  SourcePath,
  Schema,
} from "@valbuild/core";

export type ServiceOptions = {
  /**
   * Relative path to the val.config.js file from the root directory.
   *
   * @example "./val.config"
   */
  valConfigPath?: string;
  /**
   * Disable cache for transpilation
   *
   * @default false
   *    */
  disableCache?: boolean;
};

export async function createService(
  projectRoot: string,
  opts: ServiceOptions,
  host: IValFSHost = {
    ...ts.sys,
    writeFile: fs.writeFileSync,
  },
  loader?: ValModuleLoader
): Promise<Service> {
  const compilerOptions = getCompilerOptions(projectRoot, host);
  const sourceFileHandler = new ValSourceFileHandler(
    projectRoot,
    compilerOptions,
    host
  );
  const module = await newQuickJSWASMModule();
  const runtime = await newValQuickJSRuntime(
    module,
    loader ||
      new ValModuleLoader(
        projectRoot,
        compilerOptions,
        sourceFileHandler,
        host,
        opts.disableCache === undefined
          ? process.env.NODE_ENV === "development"
            ? false
            : true
          : opts.disableCache
      )
  );
  return new Service(opts, sourceFileHandler, runtime);
}

export class Service {
  readonly valConfigPath: string;

  constructor(
    { valConfigPath }: ServiceOptions,
    private readonly sourceFileHandler: ValSourceFileHandler,
    private readonly runtime: QuickJSRuntime
  ) {
    this.valConfigPath = valConfigPath || "./val.config";
  }

  async get(
    moduleId: ModuleId,
    modulePath: ModulePath
  ): Promise<SerializedModuleContent> {
    const valModule = await readValFile(
      moduleId,
      this.valConfigPath,
      this.runtime
    );

    if (valModule.source && valModule.schema) {
      const resolved = Internal.resolvePath(
        modulePath,
        valModule.source,
        valModule.schema
      );
      const sourcePath = (
        resolved.path ? [moduleId, resolved.path].join(".") : moduleId
      ) as SourcePath;
      return {
        path: sourcePath,
        schema:
          resolved.schema instanceof Schema
            ? resolved.schema.serialize()
            : resolved.schema,
        source: resolved.source,
        errors:
          valModule.errors && valModule.errors.validation
            ? {
                validation: valModule.errors.validation || undefined,
                fatal: valModule.errors.fatal || undefined,
              }
            : valModule.errors
            ? {
                fatal: valModule.errors.fatal || undefined,
              }
            : false,
      };
    } else {
      return valModule;
    }
  }

  async patch(moduleId: string, patch: Patch): Promise<void> {
    return patchValFile(
      moduleId,
      this.valConfigPath,
      patch,
      this.sourceFileHandler,
      this.runtime
    );
  }

  dispose() {
    this.runtime.dispose();
  }
}
