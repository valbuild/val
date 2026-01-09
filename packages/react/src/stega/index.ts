// NOTE: the exports of this file needs to be kept in sync with ValQuickJSRuntime
export { autoTagJSX } from "./autoTagJSX";
export {
  stegaEncode,
  getModuleIds,
  stegaClean,
  type ValEncodedString,
  type StegaOfSource,
  type StegaOfRichTextSource,
  type File,
  type Image,
  type RichText,
} from "./stegaEncode";
export { stegaDecodeStrings } from "./stegaDecodeStrings";

let isRSC = false;
let autoTagJSXEnabled = false;
export function IS_AUTO_TAG_JSX_ENABLED() {
  return autoTagJSXEnabled;
}
export function SET_AUTO_TAG_JSX_ENABLED(enabled: boolean) {
  autoTagJSXEnabled = enabled;
}

export function IS_RSC() {
  return isRSC;
}

export function SET_RSC(enabled: boolean) {
  isRSC = enabled;
}
