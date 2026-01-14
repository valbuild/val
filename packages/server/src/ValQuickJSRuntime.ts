import { JSModuleNormalizeResult, QuickJSWASMModule } from "quickjs-emscripten";
import { ValModuleLoader } from "./ValModuleLoader";
import { VAL_APP_ID, VAL_CSS_PATH, VAL_OVERLAY_ID } from "@valbuild/ui";

export async function newValQuickJSRuntime(
  quickJSModule: Pick<QuickJSWASMModule, "newRuntime">,
  moduleLoader: ValModuleLoader,
  {
    maxStackSize = 1024 * 20, // maximum stack size that works: 1024 * 640 * 8
    memoryLimit = 1024 * 640, // 640 mbs
  }: {
    maxStackSize?: number;
    memoryLimit?: number;
  } = {},
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
        if (modulePath === "@valbuild/react/internal") {
          return {
            value: `
const useVal = () => { throw Error('Cannot use \\'useVal\\' in this type of file') };
export function ValProvider() { throw Error('Cannot use \\'ValProvider\\' in this type of file') }; 
export function ValRichText() { throw Error('Cannot use \\'ValRichText\\' in this type of file')};`,
          };
        }
        if (modulePath === "@valbuild/ui") {
          return {
            value: `
export const ValOverlay = () => {
  throw Error("Cannot use 'ValOverlay' in this type of file")
};
export const VAL_CSS_PATH = "${VAL_CSS_PATH}";
export const VAL_APP_PATH = "${VAL_CSS_PATH}";
export const VAL_APP_ID = "${VAL_APP_ID}";
export const VAL_OVERLAY_ID = "${VAL_OVERLAY_ID}";
export const IS_DEV = false;
export const VERSION = "0.0.0";
`,
          };
        }
        if (modulePath === "@valbuild/react/stega") {
          return {
            value:
              "export const useVal = () => { throw Error(`Cannot use 'useVal' in this type of file`) };export const fetchVal = () => { throw Error(`Cannot use 'fetchVal' in this type of file`) }; export const autoTagJSX = () => { /* ignore */ }; export const stegaClean = () => { throw Error(`Cannot use 'stegaClean' in this type of file`) }; export const stegaDecodeStrings = () => { throw Error(`Cannot use 'stegaDecodeStrings' in this type of file`) };  export const stegaEncode = () => { throw Error(`Cannot use 'stegaEncode' in this type of file`) }; export const raw = () => { throw Error(`Cannot use 'raw' in this type of file`) }; export const attrs = () => { throw Error(`Cannot use 'attrs' in this type of file`) }; ",
          };
        }
        if (modulePath.startsWith("next/navigation")) {
          return {
            value:
              "export const usePathname = () => { throw Error(`Cannot use 'usePathname' in this type of file`) }; export const useRouter = () => { throw Error(`Cannot use 'useRouter' in this type of file`) }; export default new Proxy({}, { get() { return () => { throw new Error(`Cannot import 'next' in this file`) } } } );",
          };
        }
        if (modulePath.startsWith("next")) {
          return {
            value:
              "export default new Proxy({}, { get() { return () => { throw new Error(`Cannot import 'next' in this file`) } } } );",
          };
        }
        if (modulePath.startsWith("react/jsx-runtime")) {
          return {
            value:
              "export const jsx = () => { throw Error(`Cannot use 'jsx' in this type of file`) }; export const Fragment = () => { throw Error(`Cannot use 'Fragment' in this type of file`) }; export default new Proxy({}, { get() { return () => { throw new Error(`Cannot import 'react' in this file`) } } } ); export const jsxs = () => { throw Error(`Cannot use 'jsxs' in this type of file`) };",
          };
        }
        if (modulePath.startsWith("react")) {
          return {
            value: `
export const createContext = () => new Proxy({}, { get() { return () => { throw new Error('Cannot use \\'createContext\\' in this file') } } } );
export const useTransition = () => { throw Error('Cannot use \\'useTransition\\' in this type of file') }; 

export default new Proxy({}, { 
  get(target, props) { 
    // React.createContext might be called on top-level
    if (props === 'createContext') {
      return createContext;
    }
    return () => {
      throw new Error('Cannot import \\'react\\' in this file');
    }
  }
})`,
          };
        }
        if (modulePath.includes("/ValNextProvider")) {
          return {
            value:
              "export const ValNextProvider = new Proxy({}, { get() { return () => { throw new Error(`Cannot import 'ValNextProvider' in this file`) } } } )",
          };
        }
        if (modulePath.includes("/ValContext")) {
          return {
            value:
              "export const useValEvents = () => { throw Error(`Cannot use 'useValEvents' in this type of file`) }; export const ValContext = new Proxy({}, { get() { return () => { throw new Error(`Cannot import 'ValContext' in this file`) } } } ) export const ValEvents = new Proxy({}, { get() { return () => { throw new Error(`Cannot import 'ValEvents' in this file`) } } } )",
          };
        }
        if (modulePath.includes("/ValImage")) {
          return {
            value:
              "export const ValImage = new Proxy({}, { get() { return () => { throw new Error(`Cannot import 'ValImage' in this file`) } } } )",
          };
        }
        if (modulePath.includes("/ValApp")) {
          return {
            value:
              "export const ValApp = new Proxy({}, { get() { return () => { throw new Error(`Cannot import 'ValApp' in this file`) } } } )",
          };
        }
        return { value: moduleLoader.getModule(modulePath) };
      } catch (e) {
        return {
          error: Error(`Could not resolve module: '${modulePath}'`),
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
        if (requestedName === "@valbuild/react/internal") {
          return { value: requestedName };
        }
        if (requestedName === "@valbuild/ui") {
          return { value: requestedName };
        }
        if (requestedName.startsWith("next/navigation")) {
          return { value: requestedName };
        }
        if (requestedName.startsWith("next")) {
          return { value: requestedName };
        }
        if (requestedName.startsWith("react/jsx-runtime")) {
          return { value: requestedName };
        }
        if (requestedName.startsWith("react")) {
          return { value: requestedName };
        }
        if (requestedName.includes("/ValNextProvider")) {
          return { value: requestedName };
        }
        if (requestedName.includes("/ValContext")) {
          return { value: requestedName };
        }
        if (requestedName.includes("/ValImage")) {
          return { value: requestedName };
        }
        if (requestedName.includes("/ValApp")) {
          return { value: requestedName };
        }
        const modulePath = moduleLoader.resolveModulePath(
          baseModuleName,
          requestedName,
        );
        return { value: modulePath };
      } catch (e) {
        console.debug(
          `Could not resolve ${requestedName} in ${baseModuleName}`,
          e,
        );
        return { value: requestedName };
      }
    },
  );
  return runtime;
}
