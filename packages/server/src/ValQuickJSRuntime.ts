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
        // Special cases for next package:
        // TODO: this is not stable, find a better way to do this
        if (modulePath === "./autoTagJSX") {
          return { value: "" }; // ignore this module, it's only used in the browser
        }
        if (modulePath === "@valbuild/react") {
          return {
            value:
              "export const useVal = () => { throw Error(`Cannot use 'useVal' in this type of file`) }; export function ValProvider() { throw Error(`Cannot use 'ValProvider' in this type of file`) }; export function ValRichText() { throw Error(`Cannot use 'ValRichText' in this type of file`)};",
          };
        }
        return { value: moduleLoader.getModule(modulePath) };
      } catch (e) {
        return {
          error: Error(`Could not resolve module: ${modulePath}'`),
        };
      }
    },
    (baseModuleName, requestedName): JSModuleNormalizeResult => {
      try {
        if (requestedName === "./autoTagJSX") {
          return { value: requestedName };
        }
        if (requestedName === "@valbuild/react") {
          return { value: requestedName };
        }
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
