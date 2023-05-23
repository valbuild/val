import { newQuickJSWASMModule, QuickJSRuntime } from "quickjs-emscripten";
import { patchValFile } from "./patchValFile";
import { readValFile } from "./readValFile";
import { Patch } from "@valbuild/lib/patch";
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
  SelectorSource,
} from "@valbuild/lib";

export type ServiceOptions = {
  /**
   * Relative path to the val.config.js file from the root directory.
   *
   * @example src/val.config
   */
  valConfigPath: string;
};

export async function createService(
  projectRoot: string,
  opts: ServiceOptions,
  host: IValFSHost = {
    ...ts.sys,
    writeFile: fs.writeFileSync,
  }
): Promise<Service> {
  const compilerOptions = getCompilerOptions(projectRoot, host);
  const sourceFileHandler = new ValSourceFileHandler(
    projectRoot,
    compilerOptions,
    host
  );
  const loader = new ValModuleLoader(
    projectRoot,
    compilerOptions,
    sourceFileHandler,
    host
  );
  const module = await newQuickJSWASMModule();
  const runtime = await newValQuickJSRuntime(module, loader);
  return new Service(opts, sourceFileHandler, runtime);
}

export class Service {
  readonly valConfigPath: string;

  constructor(
    { valConfigPath }: ServiceOptions,
    private readonly sourceFileHandler: ValSourceFileHandler,
    private readonly runtime: QuickJSRuntime
  ) {
    this.valConfigPath = valConfigPath;
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

    const resolved = Internal.resolvePath(
      modulePath,
      valModule.source,
      valModule.schema
    );
    return {
      id: [valModule.id, modulePath].join("/") as SourcePath,
      schema:
        resolved.schema instanceof Schema<SelectorSource>
          ? resolved.schema.serialize()
          : resolved.schema,
      source: resolved.source,
    };
  }

  async patch(
    moduleId: string,
    patch: Patch
  ): Promise<SerializedModuleContent> {
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
