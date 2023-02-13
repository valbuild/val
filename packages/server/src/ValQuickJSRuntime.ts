import { JSModuleNormalizeResult, QuickJSWASMModule } from "quickjs-emscripten";
import { ValModuleLoader } from "./ValModuleLoader";

export async function newValQuickJSRuntime(
  quickJSModule: Pick<QuickJSWASMModule, "newRuntime">,
  moduleLoader: ValModuleLoader,
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
        return { value: moduleLoader.getModule(modulePath) };
      } catch (e) {
        return {
          error: Error(`Could not resolve module: ${modulePath}'`),
        };
      }
    },
    (baseModuleName, requestedName): JSModuleNormalizeResult => {
      try {
        const modulePath = moduleLoader.resolveModulePath(
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
