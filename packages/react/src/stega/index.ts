// NOTE: the exports of this file needs to be kept in sync with ValQuickJSRuntime
export { autoTagJSX } from "./autoTagJSX";
export {
  stegaEncode,
  getModuleIds,
  stegaClean,
  type ValEncodedString,
  type StegaOfSource,
} from "./stegaEncode";
export { type Image } from "./stegaEncode";
export { stegaDecodeString } from "./stegaDecodeString";
let autoTagJSXEnabled = false;
export function IS_AUTO_TAG_JSX_ENABLED() {
  return autoTagJSXEnabled;
}
export function SET_AUTO_TAG_JSX_ENABLED(enabled: boolean) {
  autoTagJSXEnabled = enabled;
}
