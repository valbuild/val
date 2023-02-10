import { JSModuleNormalizeResult, QuickJSWASMModule } from "quickjs-emscripten";
import { ValModuleResolver } from "./ValModuleResolver";

export async function newValQuickJSRuntime(
  quickJSModule: Pick<QuickJSWASMModule, "newRuntime">,
  moduleResolver: ValModuleResolver,
  {
    maxStackSize = 1024 * 640, // TODO: these were randomly chosen, we should figure out what the right values are:
    memoryLimit = 1024 * 640,
  }: {
    maxStackSize?: number;
    memoryLimit?: number;
  } = {}
) {
  const runtime = quickJSModule.newRuntime();

  runtime.setMaxStackSize(maxStackSize);
  runtime.setMemoryLimit(memoryLimit);

  runtime.setModuleLoader(
    (modulePath) => {
      try {
        return { value: moduleResolver.getTranspiledCode(modulePath) };
      } catch (e) {
        return {
          error: Error(`Could not resolve module: ${modulePath}'`),
        };
      }
    },
    (baseModuleName, requestedName): JSModuleNormalizeResult => {
      try {
        const modulePath = moduleResolver.resolveRuntimeModulePath(
          baseModuleName,
          requestedName
        );
        return { value: modulePath };
      } catch (e) {
        console.debug(
          `Could not resolve ${requestedName} in ${baseModuleName}`,
          e
        );
        return { value: requestedName };
      }
    }
  );
  return runtime;
}
