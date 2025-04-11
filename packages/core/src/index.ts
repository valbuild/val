export { initVal, type ConfigDirectory } from "./initVal";
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
export type { ValModule, SerializedModule, InferValModuleType } from "./module";
export type { SourceObject, SourcePrimitive, Source } from "./source";
export type { FileSource } from "./source/file";
export type { RemoteSource, RemoteRef } from "./source/remote";
export { DEFAULT_VAL_REMOTE_HOST } from "./schema/remote";
export type { RawString } from "./schema/string";
export type { ImageSource } from "./source/image";
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
  SerializedRichTextOptions,
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
  type ParentPatchId,
} from "./val";
export type { Json, JsonPrimitive, JsonArray, JsonObject } from "./Json";
export type {
  ValidationError,
  ValidationErrors,
} from "./schema/validation/ValidationError";
export type { ValidationFix } from "./schema/validation/ValidationFix";
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
  splitModulePath,
  splitModuleFilePath,
  resolvePath,
  splitModuleFilePathAndModulePath,
  joinModuleFilePathAndModulePath,
  parentOfSourcePath,
  patchPathToModulePath,
  splitJoinedSourcePaths,
} from "./module";
const ModuleFilePathSep = "?p=";
export { ModuleFilePathSep };
import { getSchema } from "./selector";
import { ModulePath, getValPath, isVal } from "./val";
import { convertFileSource } from "./schema/file";
import { createValPathOfItem } from "./selector/SelectorProxy";
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
import { type ImageMetadata } from "./schema/image";
import { type FileMetadata } from "./schema/file";
import { isFile } from "./source/file";
import { createRemoteRef } from "./source/remote";
import {
  getValidationBasis,
  getValidationHash,
} from "./remote/validationBasis";
import { getFileHash, hashToRemoteFileHash } from "./remote/fileHash";
import { splitRemoteRef } from "./remote/splitRemoteRef";
import { convertRemoteSource } from "./schema/remote";
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
export {
  type SerializedUnionSchema,
  UnionSchema,
  type SerializedStringUnionSchema,
  type SerializedObjectUnionSchema,
} from "./schema/union";
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

export const DEFAULT_CONTENT_HOST = "https://content.val.build";
export const DEFAULT_APP_HOST = "https://app.val.build";

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
  convertRemoteSource,
  getSchema,
  getValPath,
  getSource,
  resolvePath,
  splitModuleFilePathAndModulePath,
  joinModuleFilePathAndModulePath,
  remote: {
    createRemoteRef,
    getValidationBasis,
    getValidationHash,
    getFileHash,
    hashToRemoteFileHash,
    splitRemoteRef,
  },
  isVal,
  isFile,
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
    remote: boolean;
  } => op.op === "file" && typeof op.filePath === "string",
  createPatchJSONPath: (modulePath: ModulePath) =>
    `/${modulePath
      .split(".")
      .map((segment) => segment && tryJsonParse(segment))
      .join("/")}`,
  createPatchPath: (modulePath: ModulePath) => {
    return splitModulePath(modulePath);
  },
  splitModulePath,
  splitModuleFilePath,
  splitJoinedSourcePaths,
  parentOfSourcePath,
  patchPathToModulePath,
  VAL_ENABLE_COOKIE_NAME: "val_enable" as const,
  VAL_STATE_COOKIE: "val_state" as const,
  VAL_SESSION_COOKIE: "val_session" as const,
  createFilename: (
    data: string | null,
    filename: string | null,
    metadata: FileMetadata | ImageMetadata | undefined,
    sha256: string,
  ) => {
    if (!metadata) {
      return filename;
    }
    if (!data) {
      return filename;
    }
    const shaSuffix = sha256.slice(0, 5);
    const mimeType = Internal.getMimeType(data) ?? "unknown";
    const newExt = Internal.mimeTypeToFileExt(mimeType) ?? "unknown"; // Don't trust the file extension
    if (filename) {
      let cleanFilename =
        filename.split(".").slice(0, -1).join(".") || filename; // remove extension if it exists
      const maybeShaSuffixPos = cleanFilename.lastIndexOf("_");
      const currentShaSuffix = cleanFilename.slice(
        maybeShaSuffixPos + 1,
        cleanFilename.length,
      );
      if (currentShaSuffix === shaSuffix) {
        cleanFilename = cleanFilename.slice(0, maybeShaSuffixPos);
      }
      const escapedFilename = encodeURIComponent(cleanFilename)
        .replace(/%[0-9A-Fa-f]{2}/g, "")
        .toLowerCase();
      return `${escapedFilename}_${shaSuffix}.${newExt}`;
    }
    return `${sha256}.${newExt}`;
  },
};

function tryJsonParse(str: string) {
  try {
    return JSON.parse(str);
  } catch (err) {
    return str;
  }
}

export { Internal };
