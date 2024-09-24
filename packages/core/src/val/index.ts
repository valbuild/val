import { Source, SourceArray, SourceObject } from "../source";
import { Val as ObjectVal } from "./object";
import { Val as ArrayVal } from "./array";
import { Val as PrimitiveVal } from "./primitive";
import { Json, JsonArray, JsonObject, JsonPrimitive } from "../Json";
import { Path, Selector } from "../selector";
import { I18nSource } from "../source/future/i18n";
import { RemoteSource } from "../source/future/remote";
import { FileSource } from "../source/file";

export type SerializedVal = {
  val: SerializedVal | Json;
  valPath: SourcePath | undefined;
};
export function isSerializedVal(val: unknown): val is SerializedVal {
  return (
    typeof val === "object" &&
    val !== null &&
    val !== undefined &&
    ("val" in val || "valPath" in val)
  );
}

export type JsonOfSource<T extends Source> = Json extends T
  ? Json
  : T extends I18nSource<readonly string[], infer U>
    ? JsonOfSource<U>
    : T extends RemoteSource<infer U>
      ? JsonOfSource<U>
      : T extends FileSource
        ? { url: string }
        : T extends SourceObject
          ? {
              [key in keyof T]: JsonOfSource<T[key]>;
            }
          : T extends SourceArray
            ? JsonOfSource<T[number]>[]
            : T extends JsonPrimitive
              ? T
              : never;

export type Val<T extends Json> = Json extends T
  ? {
      readonly [Path]: SourcePath | undefined;
      readonly val: Source;
    }
  : T extends JsonObject
    ? ObjectVal<T>
    : T extends JsonArray
      ? ArrayVal<T>
      : T extends JsonPrimitive
        ? PrimitiveVal<T>
        : never;

export function isVal<T extends Json>(val: unknown): val is Val<T> {
  return (
    typeof val === "object" &&
    val !== null &&
    val !== undefined &&
    Path in val &&
    "val" in val
  );
}

declare const brand = "VAL_DATA_TYPE";
/**
 * The path of the source value.
 *
 * @example
 * '/app/blogs.val.ts?p=0.text' // the text property of the first element of the /app/blogs module
 */
export type SourcePath = string & {
  [brand]: "SourcePath";
};

/**
 * The path inside the module.
 *
 * @example
 * '0."text"' // the text property of the first element of the module
 */
export type ModulePath = string & {
  [brand]: "ModulePath";
};

/**
 * The path of the module.
 *
 * @example
 * '/app/blogs.val.ts'
 */
export type ModuleFilePath = string & {
  [brand]: "ModuleFilePath";
};

export type PatchId = string & {
  [brand]: "PatchId";
};

/**
 * The patchId of the parent patch, or "head" if there is no parent patch.
 */
export type ParentPatchId = string & {
  [brand]: "ParentPatchId";
};

export function getValPath(
  valOrSelector: Val<Json> | Selector<Source>,
): SourcePath | undefined {
  return valOrSelector[Path];
}
