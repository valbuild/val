import { SerializedSchema, ValidTypes } from "@valbuild/lib";
import { newQuickJSWASMModule, QuickJSRuntime } from "quickjs-emscripten";
import { patchValFile } from "./patchValFile";
import { readValFile } from "./readValFile";
import { Patch } from "./patch/patch";
import { ValModuleResolver } from "./ValModuleResolver";
import { newValQuickJSRuntime } from "./ValQuickJSRuntime";

export type ServiceOptions = {
  /**
   * Relative path to the val.config.js file from the root directory.
   *
   * @example src/val.config
   */
  valConfigPath: string;
};

export async function createService(
  resolver: ValModuleResolver,
  opts: ServiceOptions
): Promise<Service> {
  const module = await newQuickJSWASMModule();
  const runtime = await newValQuickJSRuntime(module, resolver);
  return new Service(opts, resolver, runtime);
}

export class Service {
  readonly valConfigPath: string;

  constructor(
    { valConfigPath }: ServiceOptions,
    private readonly resolver: ValModuleResolver,
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
    return patchValFile(moduleId, this.valConfigPath, patch, this.resolver);
  }

  dispose() {
    this.runtime.dispose();
  }
}
