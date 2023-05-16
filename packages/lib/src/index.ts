export { initVal } from "./initVal";
export {
  fetchVal,
  getVal, // TODO: remove getVal, only fetchVal should be public
} from "./fetchVal";
export type { InitVal } from "./initVal";
export { Schema, type SerializedSchema } from "./schema";
export type { ValModule } from "./module";
export type { SourceObject, SourcePrimitive, Source } from "./source";
export type { FileSource } from "./source/file";
export type { RemoteSource } from "./source/remote";
export { type Val, getValPath, type SerializedVal } from "./val";
export * as expr from "./expr/";
// export type { ValImage } from "./schema/image";
export { FILE_REF_PROP } from "./source/file";
export { derefPatch } from "./patch/deref";
export {
  type SelectorSource,
  type SelectorOf,
  GenericSelector,
} from "./selector";
