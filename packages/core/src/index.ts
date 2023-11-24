export { initVal } from "./initVal";
export type { InitVal, ValConfig } from "./initVal";
export { Schema, type SerializedSchema } from "./schema";
export type { ImageMetadata } from "./schema/image";
export type { LinkSource } from "./source/link";
export type { ValModule, SerializedModule } from "./module";
export type { SourceObject, SourcePrimitive, Source } from "./source";
export type { FileSource } from "./source/file";
export type { RawString } from "./schema/string";
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
export { FILE_REF_PROP } from "./source/file";
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
import { convertFileSource } from "./schema/image";
import { createValPathOfItem } from "./selector/SelectorProxy";
import { getVal } from "./future/fetchVal";
import type { Json } from "./Json";
import { SerializedSchema } from "./schema";
import { getSHA256Hash } from "./getSha256";
import { PatchJSON } from "./patch";
export { ValApi } from "./ValApi";
export type { SerializedArraySchema } from "./schema/array";
export type { SerializedObjectSchema } from "./schema/object";
export type { SerializedRecordSchema } from "./schema/record";
export type { SerializedStringSchema } from "./schema/string";
export type { SerializedNumberSchema } from "./schema/number";
export type { SerializedBooleanSchema } from "./schema/boolean";
export type { SerializedImageSchema } from "./schema/image";
export type { SerializedRichTextSchema } from "./schema/richtext";

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
  createPatchJSONPath: (modulePath: ModulePath) =>
    `/${modulePath
      .split(".")
      .map((segment) => segment && JSON.parse(segment))
      .join("/")}`,
  VAL_ENABLE_COOKIE_NAME: "val_enable" as const,
  VAL_STATE_COOKIE: "val_state" as const,
  VAL_SESSION_COOKIE: "val_session" as const,
};

export { Internal };
