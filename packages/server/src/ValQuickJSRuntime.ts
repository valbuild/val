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
        // Special cases to avoid loading the React packages since currently React does not have a ESM build:
        // TODO: this is not stable, find a better way to do this
        if (modulePath === "@valbuild/react") {
          return {
            value:
              "export const useVal = () => { throw Error(`Cannot use 'useVal' in this type of file`) }; export function ValProvider() { throw Error(`Cannot use 'ValProvider' in this type of file`) }; export function ValRichText() { throw Error(`Cannot use 'ValRichText' in this type of file`)};",
          };
        }
        if (modulePath === "@valbuild/react/stega") {
          return {
            value:
              "export const useVal = () => { throw Error(`Cannot use 'useVal' in this type of file`) }; export const fetchVal = () => { throw Error(`Cannot use 'fetchVal' in this type of file`) }; export const autoTagJSX = () => { /* ignore */ };",
          };
        }
        return { value: moduleLoader.getModule(modulePath) };
      } catch (e) {
        return {
          error: Error(`Could not resolve module: '${modulePath}': `),
        };
      }
    },
    (baseModuleName, requestedName): JSModuleNormalizeResult => {
      try {
        if (requestedName === "@valbuild/react") {
          return { value: requestedName };
        }
        if (requestedName === "@valbuild/react/stega") {
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
