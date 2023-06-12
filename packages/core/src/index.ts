export { initVal } from "./initVal";
export { fetchVal } from "./fetchVal";
export type { InitVal } from "./initVal";
export { Schema, type SerializedSchema } from "./schema";
export type { ValModule, SerializedModule } from "./module";
export type { SourceObject, SourcePrimitive, Source } from "./source";
export type { FileSource } from "./source/file";
export type { RemoteSource } from "./source/remote";
export {
  type Val,
  type SerializedVal,
  type ModuleId,
  type ModulePath,
  type SourcePath,
  type JsonOfSource,
} from "./val";
export { type Json } from "./Json";
export * as expr from "./expr/";
export { FILE_REF_PROP } from "./source/file";
export { VAL_EXTENSION } from "./source";
export { derefPatch } from "./patch/deref";
export {
  type SelectorSource,
  type SelectorOf,
  GenericSelector,
} from "./selector";
import { getVal } from "./fetchVal";
import {
  getRawSource,
  resolvePath,
  splitModuleIdAndModulePath,
} from "./module";
import { getSchema } from "./selector";
import { getValPath } from "./val";
export type {
  RichText,
  TextNode,
  ParagraphNode,
  HeadingNode,
  ImageNode,
  ListItemNode,
  ListNode,
  RootNode,
} from "./schema/richtext";
import { convertImageSource } from "./schema/image";

const Internal = {
  convertImageSource,
  getSchema,
  getValPath,
  getVal,
  getRawSource,
  resolvePath,
  splitModuleIdAndModulePath,
};

export { Internal };
