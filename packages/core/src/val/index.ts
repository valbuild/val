import { Source, SourceArray, SourceObject } from "../source";
import { Val as ObjectVal } from "./object";
import { Val as ArrayVal } from "./array";
import { Val as PrimitiveVal } from "./primitive";
import { Json, JsonArray, JsonObject, JsonPrimitive } from "../Json";
import { Path, Selector } from "../selector";
import {
  GalleryVideoSource,
  IsVideoSource,
  MediaSource,
  ResolvedVideo,
} from "../source/media";

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
  : T extends GalleryVideoSource
    ? IsVideoSource<T> extends true
      ? ResolvedVideo<T>
      : T & { url: string }
    : T extends MediaSource
      ? T & { url: string }
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

function carriesValPath(
  value: object,
): value is { readonly [Path]: SourcePath } {
  return Path in value && typeof value[Path] === "string";
}

/**
 * The path a value was read from, for a value of ANY type: `getValPath` for
 * code that was handed something and does not know it to be a `Val`. An
 * object or a list a reader gave back carries one in draft mode
 * (`setValPath`); anything else, and everything in production, does not.
 */
export function valPathOf(value: unknown): SourcePath | undefined {
  return typeof value === "object" && value !== null && carriesValPath(value)
    ? value[Path]
    : undefined;
}

/**
 * Gives an object Val read the path it was read from, where `getValPath`
 * finds it: the readers' (`stegaEncode`'s) half of `getValPath`, for objects,
 * which have no text to carry a path in.
 *
 * Not enumerable, and a symbol: `Object.keys`, `JSON.stringify` and every walk
 * that reads content as data still see only the content.
 */
export function setValPath(target: object, path: SourcePath): void {
  Object.defineProperty(target, Path, {
    value: path,
    enumerable: false,
    configurable: true,
  });
}
