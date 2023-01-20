import { QuickJSWASMModule } from "quickjs-emscripten";
import { ValModuleResolver } from "./ValModuleResolver";

export async function newValQuickJSRuntime(
  quickJSModule: Pick<QuickJSWASMModule, "newRuntime">,
  moduleResolver: ValModuleResolver,
  {
    maxStackSize = 1024 * 640, // TODO: these were randomly chosen, we should figure out what the right values are:
    memoryLimit = 1024 * 640,
  }: {
    maxStackSize: number;
    memoryLimit: number;
  }
) {
  const runtime = quickJSModule.newRuntime();

  runtime.setMaxStackSize(maxStackSize);
  runtime.setMemoryLimit(memoryLimit);

  runtime.setModuleLoader(
    (modulePath) => {
      return moduleResolver.getTranspiledCode(modulePath);
    },
    (baseModuleName, requestedName) => {
      return moduleResolver.resolveModulePath(baseModuleName, requestedName);
    }
  );
  return runtime;
}
