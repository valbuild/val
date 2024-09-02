export { initVal } from "./initVal";
export { modules, type ValModules } from "./modules";
export type {
  InitVal,
  ValConfig,
  ValConstructor,
  ContentConstructor,
} from "./initVal";
export { Schema, type SerializedSchema, type SelectorOfSchema } from "./schema";
export type { ImageMetadata } from "./schema/image";
export type { FileMetadata } from "./schema/file";
export type { LinkSource } from "./source/link";
export type { ValModule, SerializedModule, InferValModuleType } from "./module";
export type { SourceObject, SourcePrimitive, Source } from "./source";
export type { FileSource } from "./source/file";
export type { RawString } from "./schema/string";
export type { ImageSource } from "./source/image";
export { RT_IMAGE_TAG } from "./source/richtext";
export type {
  AllRichTextOptions,
  Bold,
  Styles,
  HeadingNode,
  ImageNode,
  Italic,
  LineThrough,
  ListItemNode,
  LinkNode,
  OrderedListNode,
  ParagraphNode,
  BrNode,
  RichTextNode,
  RichTextOptions,
  RichTextSource,
  BlockNode,
  SpanNode,
  UnorderedListNode,
} from "./source/richtext";
export {
  type Val,
  type SerializedVal,
  type ModuleFilePath,
  type PatchId,
  type ModulePath,
  type SourcePath,
  type JsonOfSource,
} from "./val";
export type { Json, JsonPrimitive, JsonArray, JsonObject } from "./Json";
export type {
  ValidationError,
  ValidationErrors,
} from "./schema/validation/ValidationError";
export type { ValidationFix } from "./schema/validation/ValidationFix";
export * as expr from "./expr/";
export { FILE_REF_PROP, FILE_REF_SUBTYPE_TAG } from "./source/file";
export { VAL_EXTENSION, type SourceArray } from "./source";
export { derefPatch } from "./patch/deref";
export {
  type SelectorSource,
  type SelectorOf,
  GenericSelector,
} from "./selector";
import {
  getSource,
  parsePath,
  resolvePath,
  splitModuleFilePathAndModulePath,
  ModuleFilePathSep,
} from "./module";
import { getSchema } from "./selector";
import { ModulePath, getValPath, isVal } from "./val";
import { convertFileSource } from "./schema/file";
import { createValPathOfItem } from "./selector/SelectorProxy";
import { getVal } from "./future/fetchVal";
import { getSHA256Hash } from "./getSha256";
import { Operation } from "./patch";
import { initSchema } from "./initSchema";
import {
  getMimeType,
  mimeTypeToFileExt,
  filenameToMimeType,
  EXT_TO_MIME_TYPES,
  MIME_TYPES_TO_EXT,
} from "./mimeType";
export { type SerializedArraySchema, ArraySchema } from "./schema/array";
export { type SerializedObjectSchema, ObjectSchema } from "./schema/object";
export { type SerializedRecordSchema, RecordSchema } from "./schema/record";
export { type SerializedStringSchema, StringSchema } from "./schema/string";
export { type SerializedNumberSchema, NumberSchema } from "./schema/number";
export { type SerializedBooleanSchema, BooleanSchema } from "./schema/boolean";
export { type SerializedImageSchema, ImageSchema } from "./schema/image";
export { type SerializedFileSchema, FileSchema } from "./schema/file";
export { type SerializedDateSchema, DateSchema } from "./schema/date";
export { type SerializedKeyOfSchema, KeyOfSchema } from "./schema/keyOf";
export {
  type SerializedRichTextSchema,
  RichTextSchema,
} from "./schema/richtext";
export { type SerializedUnionSchema, UnionSchema } from "./schema/union";
export { type SerializedLiteralSchema, LiteralSchema } from "./schema/literal";
export { deserializeSchema } from "./schema/deserialize";

export const FATAL_ERROR_TYPES = [
  "no-schema",
  "no-source",
  "invalid-id",
  "no-module",
  "invalid-patch",
] as const;
export type FatalErrorType = (typeof FATAL_ERROR_TYPES)[number];

const Internal = {
  VERSION: {
    core: ((): string | null => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require("../package.json").version;
      } catch {
        return null;
      }
    })(),
  },
  convertFileSource,
  getSchema,
  getValPath,
  getVal,
  getSource,
  resolvePath,
  splitModuleFilePathAndModulePath,
  isVal,
  createValPathOfItem,
  getSHA256Hash,
  initSchema,
  getMimeType,
  mimeTypeToFileExt,
  filenameToMimeType,
  EXT_TO_MIME_TYPES,
  MIME_TYPES_TO_EXT,
  ModuleFilePathSep,
  notFileOp: (op: Operation) => op.op !== "file",
  isFileOp: (
    op: Operation,
  ): op is {
    op: "file";
    path: string[];
    filePath: string;
    value: string;
  } => op.op === "file" && typeof op.filePath === "string",
  createPatchJSONPath: (modulePath: ModulePath) =>
    `/${modulePath
      .split(".")
      .map((segment) => segment && tryJsonParse(segment))
      .join("/")}`,
  createPatchPath: (modulePath: ModulePath) => {
    return parsePath(modulePath);
  },
  patchPathToModulePath: (patchPath: string[]): ModulePath => {
    return patchPath
      .map((segment) => {
        // TODO: I am worried that something is lost here: what if the segment is a string that happens to be a parsable as a number? We could make those keys illegal?
        if (Number.isInteger(Number(segment))) {
          return segment;
        }
        return JSON.stringify(segment);
      })
      .join(".") as ModulePath;
  },
  VAL_ENABLE_COOKIE_NAME: "val_enable" as const,
  VAL_STATE_COOKIE: "val_state" as const,
  VAL_SESSION_COOKIE: "val_session" as const,
};
function tryJsonParse(str: string) {
  try {
    return JSON.parse(str);
  } catch (err) {
    return str;
  }
}

export { Internal };
