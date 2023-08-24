export { initVal } from "./initVal";
export type { InitVal } from "./initVal";
export { Schema, type SerializedSchema } from "./schema";
export type { ValModule, SerializedModule } from "./module";
export type { SourceObject, SourcePrimitive, Source } from "./source";
export type { FileSource } from "./source/file";
export type { RemoteSource } from "./source/remote";
export type {
  RichTextSource,
  RichText,
  TextNode,
  ParagraphNode,
  HeadingNode,
  ListItemNode,
  ListNode,
} from "./source/richtext";
export {
  type Val,
  type SerializedVal,
  type ModuleId,
  type ModulePath,
  type SourcePath,
  type JsonOfSource,
} from "./val";
export type { Json, JsonPrimitive } from "./Json";
export type {
  ValidationErrors,
  ValidationError,
} from "./schema/validation/ValidationError";
export type { ValidationFix } from "./schema/validation/ValidationFix";
export * as expr from "./expr/";
export { FILE_REF_PROP } from "./source/file";
export { VAL_EXTENSION, type SourceArray } from "./source";
export type { I18nSource } from "./source/i18n";
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
import { getValPath, isVal } from "./val";
import { convertImageSource } from "./schema/image";
import { fetchVal } from "./fetchVal";

const Internal = {
  convertImageSource,
  getSchema,
  getValPath,
  getVal,
  getRawSource,
  resolvePath,
  splitModuleIdAndModulePath,
  fetchVal,
  isVal,
};

export { Internal };
