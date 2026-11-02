// NOTE: the exports of this file needs to be kept in sync with the stubs in loadValModules
export { autoTagJSX } from "./autoTagJSX";
export {
  stegaEncode,
  getModuleIds,
  stegaClean,
  type ValEncodedString,
  type StegaOfSource,
  type ResolvedVal,
  type Resolvable,
  type JsonEntryContentOf,
  type RouteValueOf,
  type StegaOfRichTextSource,
  type File,
  type Image,
  type Video,
  type RichText,
} from "./stegaEncode";
export { stegaDecodeStrings } from "./stegaDecodeStrings";
// How every reader of @valbuild/next and @valbuild/tanstack loads content:
// the sources, `layered`, `resolveVal`. Not for apps; here because it is what
// the framework packages share, beside the encoder it ends in.
export * from "../read";
export { attrs } from "./attrs";
export { raw, type DecodeVal } from "./raw";
export {
  findStegaLeaks,
  watchStegaLeaks,
  stegaLeakMessage,
  isReactDevelopmentBuild,
  type StegaLeak,
} from "./stegaLeaks";

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
