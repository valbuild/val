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
import type {
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
import {
  ModuleFilePath,
  ModulePath,
  PatchId,
  SourcePath,
  getValPath,
  isVal,
} from "./val";
import { convertFileSource } from "./schema/file";
import { createValPathOfItem } from "./selector/SelectorProxy";
import { getVal } from "./future/fetchVal";
import type { Json } from "./Json";
import { getSHA256Hash } from "./getSha256";
import { Operation, Patch } from "./patch";
import { initSchema } from "./initSchema";
import { SerializedSchema } from "./schema";
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
export { deserializeSchema } from "./schema/deserialize";

// Move to internal
export { ValApi } from "./ValApi";

// eslint-disable-next-line @typescript-eslint/ban-types
export type ApiCommitResponse = {};

export type ApiSchemaResponse = {
  schemaSha: string;
  schemas: Record<ModuleFilePath, SerializedSchema>;
};

export type ApiTreeResponse = {
  schemaSha: string;
  fatalErrors?: (
    | {
        message: string;
        type: "invalid-module-file-path";
        actualModuleFilePath: string;
        expectedModuleFilePath: string;
      }
    | {
        message: string;
        stack?: string;
        type?: undefined;
      }
  )[];
  modules: Record<
    ModuleFilePath,
    {
      source: Json;
      patches?: {
        applied: PatchId[];
        skipped?: PatchId[];
        errors?: Record<PatchId, { message: string }>;
      };
      validationErrors?: Record<SourcePath, ValidationError[]>;
    }
  >;
};

export type ApiGetPatchResponse = {
  patches: Record<
    PatchId,
    {
      path: ModuleFilePath;
      patch?: Patch;
      createdAt: string;
      authorId: string | null;
      appliedAt: {
        baseSha: string;
        git?: { commitSha: string };
        timestamp: string;
      } | null;
    }
  >;
  error?: {
    message: string;
  };
  errors?: Record<
    PatchId,
    {
      message: string;
    }
  >;
};
export type ApiDeletePatchResponse = PatchId[];
export type ApiPostPatchResponse = Record<
  ModuleFilePath,
  {
    patch_id: PatchId;
  }
>;
export type ApiPostValidationResponse = {
  validationErrors: false;
  modules: Record<
    ModuleFilePath,
    {
      patches: {
        applied: PatchId[];
      };
    }
  >;
};
export const FATAL_ERROR_TYPES = [
  "no-schema",
  "no-source",
  "invalid-id",
  "no-module",
  "invalid-patch",
] as const;
export type FatalErrorType = (typeof FATAL_ERROR_TYPES)[number];
export type ApiPostValidationErrorResponse = {
  modules: Record<
    ModuleFilePath,
    {
      patches: {
        applied: PatchId[];
        failed?: PatchId[];
      };
    }
  >;
  validationErrors: Record<
    ModuleFilePath,
    {
      source?: Json;
      errors: {
        invalidModulePath?: ModuleFilePath;
        validation?: ValidationErrors;
        fatal?: {
          message: string;
          stack?: string;
          type?: FatalErrorType;
        }[];
      };
    }
  >;
};

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
  ModuleFilePathSep,
  notFileOp: (op: Operation) => op.op !== "file",
  isFileOp: (
    op: Operation
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
