import { SerializedSchema, ValidTypes } from "@valbuild/lib";
import { newQuickJSWASMModule, QuickJSRuntime } from "quickjs-emscripten";
import { patchValFile } from "./patchValFile";
import { readValFile } from "./readValFile";
import { Patch } from "./patch/patch";
import { ValModuleLoader } from "./ValModuleLoader";
import { newValQuickJSRuntime } from "./ValQuickJSRuntime";
import { ValSourceFileHandler } from "./ValSourceFileHandler";
import ts from "typescript";
import { getCompilerOptions } from "./getCompilerOptions";
import { IValFSHost } from "./ValFSHost";

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
  host: IValFSHost = ts.sys
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
  readonly appBaseUrl?: string;

  constructor(
    { valConfigPath }: ServiceOptions,
    private readonly sourceFileHandler: ValSourceFileHandler,
    private readonly runtime: QuickJSRuntime
  ) {
    this.valConfigPath = valConfigPath;
  }

  async get(
    moduleId: string
  ): Promise<{ val: ValidTypes; schema: SerializedSchema }> {
    return readValFile(moduleId, this.valConfigPath, this.runtime);
  }

  async patch(moduleId: string, patch: Patch): Promise<void> {
    return patchValFile(
      moduleId,
      this.valConfigPath,
      patch,
      this.sourceFileHandler
    );
  }

  dispose() {
    this.runtime.dispose();
  }
}
