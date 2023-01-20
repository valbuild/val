import { SerializedSchema, ValidTypes } from "@valbuild/lib";
import { applyPatch, Operation } from "fast-json-patch";
import { newQuickJSWASMModule, QuickJSRuntime } from "quickjs-emscripten";
import { readValFile } from "./readValFile";
import { ValModuleResolver } from "./ValModuleResolver";
import { newValQuickJSRuntime } from "./ValQuickJSRuntime";
import { writeValFile } from "./writeValFile";

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

  async patch(moduleId: string, patch: Operation[]): Promise<void> {
    // TODO: Validate patch and/or resulting document against schema
    const document = (
      await readValFile(moduleId, this.valConfigPath, this.runtime)
    ).val;
    const result = applyPatch(document, patch, true, false);
    const newDocument = result.newDocument;

    await writeValFile(
      moduleId,
      this.valConfigPath,
      newDocument,
      this.resolver
    );
  }

  dispose() {
    this.runtime.dispose();
  }
}
