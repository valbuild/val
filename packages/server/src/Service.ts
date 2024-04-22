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
import path from "path";

export type ServiceOptions = {
  /**
   * Disable cache for transpilation
   *
   * @default false
   */
  disableCache?: boolean;
};

export async function createService(
  projectRoot: string,
  opts: ServiceOptions,
  host: IValFSHost = {
    ...ts.sys,
    writeFile: (fileName, data, encoding) => {
      fs.mkdirSync(path.dirname(fileName), { recursive: true });
      fs.writeFileSync(fileName, data, encoding);
    },
    rmFile: fs.rmSync,
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
  return new Service(projectRoot, sourceFileHandler, runtime);
}

export class Service {
  readonly projectRoot: string;

  constructor(
    projectRoot: string,
    readonly sourceFileHandler: ValSourceFileHandler,
    private readonly runtime: QuickJSRuntime
  ) {
    this.projectRoot = projectRoot;
  }

  async get(
    moduleId: ModuleId,
    modulePath: ModulePath,
    options?: { validate: boolean; source: boolean; schema: boolean }
  ): Promise<SerializedModuleContent> {
    const valModule = await readValFile(
      moduleId,
      this.projectRoot,
      this.runtime,
      options ?? { validate: true, source: true, schema: true }
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

  async patch(moduleId: ModuleId, patch: Patch): Promise<void> {
    await patchValFile(
      moduleId,
      this.projectRoot,
      patch,
      this.sourceFileHandler,
      this.runtime
    );
  }

  dispose() {
    this.runtime.dispose();
  }
}
