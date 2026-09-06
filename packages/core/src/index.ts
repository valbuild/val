export { initVal, type ConfigDirectory } from "./initVal";
export { modules, type ValModules } from "./modules";
export {
  extractValModules,
  computeValModuleShas,
  type ExtractedValModules,
  type ValModuleShaEntry,
  type ValModuleShas,
  type ExtractedModuleError,
} from "./extractValModules";
export type {
  InitVal,
  ValConfig,
  ValConstructor,
  ContentConstructor,
} from "./initVal";
export { Schema, type SerializedSchema, type SelectorOfSchema } from "./schema";
export {
  hasRemoteFileSchema,
  hasMediaSchema,
} from "./schema/hasRemoteFileSchema";
export type {
  ImageMetadata,
  ImageEncodeOption,
  ImageEncodeOptions,
} from "./schema/image";
export type { FileMetadata } from "./schema/file";
export type { ValModule, SerializedModule, InferValModuleType } from "./module";
export type { SourceObject, SourcePrimitive, Source } from "./source";
export type { FileSource } from "./source/media";
export type { JsonSource, JsonOf, JsonImportThunk } from "./source/json";
export type {
  ExternalRecordSrc,
  ExternalRecordWritableSrc,
  ExternalItemOf,
  ExternalLabelOf,
  ExternalReadonlyOf,
} from "./source/external";
export type { RemoteRef } from "./source/remote";
export { DEFAULT_VAL_REMOTE_HOST } from "./schema/remote";
export type { RawString } from "./schema/string";
export type { ImageSource } from "./source/media";
export type {
  MediaHotspot,
  MediaSource,
  GalleryImageSource,
  GalleryFileSource,
} from "./source/media";
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
export { VAL_EXTENSION, type SourceArray } from "./source";
export { derefPatch } from "./patch/deref";
export {
  type SelectorSource,
  type SelectorOf,
  GenericSelector,
} from "./selector";
import {
  getSource,
  isValModule,
  splitModulePath,
  splitModuleFilePath,
  resolvePath,
  safeResolvePath,
  splitModuleFilePathAndModulePath,
  joinModuleFilePathAndModulePath,
  parentOfSourcePath,
  patchPathToModulePath,
  splitJoinedSourcePaths,
  type ValModule,
} from "./module";
const ModuleFilePathSep = "?p=";
export { ModuleFilePathSep };
import { SelectorSource, getSchema } from "./selector";
import { ModulePath, SourcePath, getValPath, isVal } from "./val";
import { createValPathOfItem } from "./selector/SelectorProxy";
import { getSHA256Hash } from "./getSha256";
import { Operation } from "./patch";
import { initSchema } from "./initSchema";
import {
  getMimeType,
  mimeTypeToFileExt,
  filenameToMimeType,
  mimeTypeMatchesAccept,
  EXT_TO_MIME_TYPES,
  MIME_TYPES_TO_EXT,
} from "./mimeType";
import { type ImageMetadata } from "./schema/image";
import { type FileMetadata } from "./schema/file";
import { isJson, getJsonImport, resolveJsonValues } from "./source/json";
import { isExternal, hasInlineExternalEntries } from "./source/external";
import {
  createExternalFileRef,
  splitExternalFileRef,
  isExternalFileRef,
} from "./source/externalRef";
import { createRemoteRef } from "./source/remote";
import {
  getValidationBasis,
  getValidationHash,
} from "./remote/validationBasis";
import { getFileHash, hashToRemoteFileHash } from "./remote/fileHash";
import { splitRemoteRef } from "./remote/splitRemoteRef";
import {
  fillFromGallery,
  isRemoteMediaPath,
  mediaUrl,
  resolveMedia,
} from "./source/media";
import {
  colorToHex,
  convertColor,
  detectColorFormat,
  formatColor,
  parseColor,
} from "./schema/colorFormat";
export { type SerializedArraySchema, ArraySchema } from "./schema/array";
export { type SerializedObjectSchema, ObjectSchema } from "./schema/object";
export { type SerializedRecordSchema, RecordSchema } from "./schema/record";
export { type SerializedStringSchema, StringSchema } from "./schema/string";
export { type SerializedNumberSchema, NumberSchema } from "./schema/number";
export { type SerializedBooleanSchema, BooleanSchema } from "./schema/boolean";
export { type SerializedImageSchema, ImageSchema } from "./schema/image";
export { type SerializedFileSchema, FileSchema } from "./schema/file";
export { type SerializedDateSchema, DateSchema } from "./schema/date";
export {
  type SerializedSettingsSchema,
  SettingsSchema,
} from "./schema/settings";
export {
  type SettingsSource,
  type AssistantSettingsSource,
  type AssistantAvailability,
  ASSISTANT_SETTINGS_MAX_LENGTH,
  assistantAvailability,
} from "./source/settings";
export {
  type ResolvedSettingsModule,
  SETTINGS_MODULE_CONVENTION,
  isRootModuleFilePath,
  resolveSettingsModule,
} from "./settingsModule";
export {
  type SerializedColorSchema,
  type ColorOptions,
  ColorSchema,
} from "./schema/color";
export {
  type SerializedCodeSchema,
  type CodeOptions,
  type CodeLanguage,
  CodeSchema,
  CODE_LANGUAGES,
} from "./schema/code";
export {
  type ColorFormat,
  type ParsedColor,
  COLOR_FORMATS,
  DEFAULT_COLOR_FORMAT,
} from "./schema/colorFormat";
export {
  type SerializedDateTimeSchema,
  DateTimeSchema,
} from "./schema/datetime";
export { type SerializedKeyOfSchema, KeyOfSchema } from "./schema/keyOf";
export { type SerializedRouteSchema, RouteSchema } from "./schema/route";
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
export {
  type PreviewItem,
  type ItemPreviewInput,
  type RecordPreview,
  type ArrayPreview,
  type ReifiedPreview,
  type PreviewScope,
  previewScope,
} from "./preview";
export { type InlineRender, type FieldRender, isInlineRender } from "./render";
export type { ValRouter, RouteValidationError } from "./router";
export { getSourcePathFromRoute } from "./getSourcePathFromRoute";
import { nextAppRouter, externalPageRouter } from "./router";

export const FATAL_ERROR_TYPES = [
  "no-schema",
  "no-source",
  "invalid-id",
  "no-module",
  "invalid-patch",
] as const;
export type FatalErrorType = (typeof FATAL_ERROR_TYPES)[number];

export const DEFAULT_CONTENT_HOST = "https://content.val.build";
export const DEFAULT_APP_HOST = "https://admin.val.build";

const Internal = {
  VERSION: {
    core: ((): string | null => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("../package.json").version;
      } catch {
        return null;
      }
    })(),
  },
  mediaUrl,
  resolveMedia,
  isRemoteMediaPath,
  media: {
    fillFromGallery,
  },
  getSchema,
  getValPath,
  getSource,
  isValModule,
  resolvePath,
  safeResolvePath,
  splitModuleFilePathAndModulePath,
  joinModuleFilePathAndModulePath,
  nextAppRouter,
  externalPageRouter,
  color: {
    parseColor,
    formatColor,
    convertColor,
    detectColorFormat,
    colorToHex,
  },
  remote: {
    createRemoteRef,
    getValidationBasis,
    getValidationHash,
    getFileHash,
    hashToRemoteFileHash,
    splitRemoteRef,
  },
  validate: (
    val: ValModule<SelectorSource>,
    path: SourcePath,
    src: unknown,
  ) => {
    return (
      val && getSchema(val)?.["executeValidate"](path, src as SelectorSource)
    );
  },
  isVal,
  isJson,
  getJsonImport,
  resolveJsonValues,
  isExternal,
  hasInlineExternalEntries,
  createExternalFileRef,
  splitExternalFileRef,
  isExternalFileRef,
  createValPathOfItem,
  getSHA256Hash,
  initSchema,
  getMimeType,
  mimeTypeToFileExt,
  filenameToMimeType,
  mimeTypeMatchesAccept,
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
  } catch {
    return str;
  }
}

export { Internal };
