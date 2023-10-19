export { initVal } from "./initVal";
export type { InitVal } from "./initVal";
export { Schema, type SerializedSchema } from "./schema";
export type { ValModule, SerializedModule } from "./module";
export type { SourceObject, SourcePrimitive, Source } from "./source";
export type { FileSource } from "./source/file";
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
export type { Json, JsonPrimitive } from "./Json";
export type {
  ValidationErrors,
  ValidationError,
} from "./schema/validation/ValidationError";
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
import { Json } from "./Json";
import { SerializedSchema } from "./schema";
import { convertRichTextSource, internalRichText } from "./source/richtext";
import { getSHA256Hash } from "./getSha256";
import { richTextToTaggedStringTemplate } from "./source/richTextToTaggedStringTemplate";
export { ValApi } from "./ValApi";

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
    }
  >;
};

export type ApiPatchResponse = Record<ModuleId, string[]>;

const Internal = {
  convertFileSource,
  convertRichTextSource,
  getSchema,
  getValPath,
  getVal,
  getSource,
  resolvePath,
  splitModuleIdAndModulePath,
  isVal,
  createValPathOfItem,
  getSHA256Hash,
  internalRichText,
  richTextToTaggedStringTemplate,
  createPatchJSONPath: (modulePath: ModulePath) =>
    `/${modulePath
      .split(".")
      .map((segment) => JSON.parse(segment))
      .join("/")}`,
  /**
   * Enables draft mode: updates all Val modules with patches
   */
  VAL_DRAFT_MODE_COOKIE: "val_draft_mode",
  /**
   * Enables Val: show the overlay / menu
   */
  VAL_ENABLE_COOKIE_NAME: "val_enable",
  VAL_STATE_COOKIE: "val_state",
  VAL_SESSION_COOKIE: "val_session",
};

export { Internal };
