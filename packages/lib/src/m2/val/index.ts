import {
  FileSource,
  I18nSource,
  RemoteSource,
  Source,
  SourceArray,
  SourceObject,
} from "../Source";
import { Val as ObjectVal } from "./object";
import { Val as ArrayVal } from "./array";
import { Val as PrimitiveVal } from "./primitive";
import { Json, JsonArray, JsonObject, JsonPrimitive } from "../Json";

export type SerializedVal = {
  val: Json;
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
  : T extends FileSource<string>
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
      readonly valPath: SourcePath;
      readonly val: Source;
    }
  : T extends JsonObject
  ? ObjectVal<T>
  : T extends JsonArray
  ? ArrayVal<T>
  : T extends JsonPrimitive
  ? PrimitiveVal<T>
  : never;

declare const brand: unique symbol;
/**
 * The path of the source value.
 *
 * @example
 * '/app/blogs.0.text' // the text property of the first element of the /app/blogs module
 */
export type SourcePath = string & {
  [brand]: "SourcePath";
};
