export { initVal } from "./initVal";
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
  AnyRichTextOptions,
  Bold,
  Classes,
  HeadingNode,
  ImageNode,
  Italic,
  LineThrough,
  ListItemNode,
  LinkNode,
  OrderedListNode,
  ParagraphNode,
  BrNode,
  RichText,
  RichTextNode,
  RichTextOptions,
  RichTextSource,
  RootNode,
  SpanNode,
  UnorderedListNode,
} from "./source/richtext";
export {
  type Val,
  type SerializedVal,
  type ModuleId,
  type ModulePath,
  type SourcePath,
  type JsonOfSource,
} from "./val";
export type { Json, JsonPrimitive, JsonArray, JsonObject } from "./Json";
export type {
  ValidationError,
  ValidationErrors,
} from "./schema/validation/ValidationError";
import type { ValidationErrors } from "./schema/validation/ValidationError";
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
import { getSource, resolvePath, splitModuleIdAndModulePath } from "./module";
import { getSchema } from "./selector";
import { ModuleId, ModulePath, getValPath, isVal } from "./val";
import { convertFileSource } from "./schema/file";
import { createValPathOfItem } from "./selector/SelectorProxy";
import { getVal } from "./future/fetchVal";
import type { Json } from "./Json";
import { SerializedSchema } from "./schema";
import { getSHA256Hash } from "./getSha256";
import { PatchJSON } from "./patch";
import { initSchema } from "./initSchema";
export { ValApi } from "./ValApi";
export { type SerializedArraySchema, ArraySchema } from "./schema/array";
export { type SerializedObjectSchema, ObjectSchema } from "./schema/object";
export { type SerializedRecordSchema, RecordSchema } from "./schema/record";
export { type SerializedStringSchema, StringSchema } from "./schema/string";
export { type SerializedNumberSchema, NumberSchema } from "./schema/number";
export { type SerializedBooleanSchema, BooleanSchema } from "./schema/boolean";
export { type SerializedImageSchema, ImageSchema } from "./schema/image";
export { type SerializedFileSchema, FileSchema } from "./schema/file";
export {
  type SerializedRichTextSchema,
  RichTextSchema,
} from "./schema/richtext";
export { type SerializedUnionSchema, UnionSchema } from "./schema/union";
export { type SerializedLiteralSchema, LiteralSchema } from "./schema/literal";

export type ApiCommitResponse = {
  modules: Record<
    ModuleId,
    {
      patches: {
        applied: string[];
      };
    }
  >;
  git: {
    commit?: string;
    branch?: string;
  };
};

export type ApiTreeResponse = {
  git: {
    commit?: string;
    branch?: string;
  };
  modules: Record<
    ModuleId,
    {
      schema?: SerializedSchema;
      patches?: {
        applied: string[];
        failed?: string[];
      };
      source?: Json;
      errors?:
        | false
        | {
            invalidModuleId?: ModuleId;
            validation?: ValidationErrors;
            fatal?: {
              message: string;
              stack?: string;
              type?: string;
            }[];
          };
    }
  >;
};

export type ApiGetPatchResponse = Record<
  ModuleId,
  {
    patch: PatchJSON;
    patch_id: string;
    commit_sha: string;
    author: string;
    created_at: string;
  }[]
>;
export type ApiPostPatchResponse = Record<ModuleId, string[]>;

const Internal = {
  convertFileSource,
  getSchema,
  getValPath,
  getVal,
  getSource,
  resolvePath,
  splitModuleIdAndModulePath,
  isVal,
  createValPathOfItem,
  getSHA256Hash,
  initSchema,
  createPatchJSONPath: (modulePath: ModulePath) =>
    `/${modulePath
      .split(".")
      .map((segment) => segment && tryJsonParse(segment))
      .join("/")}`,
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
