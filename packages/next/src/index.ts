// Core (excluding initVal)
export { Schema, type SerializedSchema } from "@valbuild/core";
export type { SourceObject, SourcePrimitive, Source } from "@valbuild/core";
export type { ValModule, SerializedModule } from "@valbuild/core";
export type { FileSource } from "@valbuild/core";
export type { RichTextSource, RichText } from "@valbuild/core";
export {
  type Val,
  type SerializedVal,
  type ModuleId,
  type ModulePath,
  type SourcePath,
  type JsonOfSource,
} from "@valbuild/core";
export type { Json, JsonPrimitive } from "@valbuild/core";
export type { ValidationErrors, ValidationError } from "@valbuild/core";
export type { ValidationFix } from "@valbuild/core";
export * as expr from "@valbuild/core";
export { FILE_REF_PROP } from "@valbuild/core";
export { VAL_EXTENSION, type SourceArray } from "@valbuild/core";
export { derefPatch } from "@valbuild/core";
export {
  type SelectorSource,
  type SelectorOf,
  GenericSelector,
} from "@valbuild/core";

// React
export { ValRichText } from "@valbuild/react";

// Stega
export { type ValEncodedString } from "@valbuild/react/stega";

// Next specific
export { ValProvider } from "./ValProvider";
export { initVal } from "./initVal";

// Auto-tag JSX with Val paths:
import { autoTagJSX } from "@valbuild/react/stega";

// NOTE! Side effects:
autoTagJSX();
