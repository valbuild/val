import { Source, SourceObject, SourcePrimitive } from "../Source";
import { Val as ObjectVal } from "./object";
import { Val as ArrayVal } from "./array";
import { Val as PrimitiveVal } from "./primitive";

export type Val<T extends Source> = [T] extends [never]
  ? never
  : [T] extends [SourceObject]
  ? ObjectVal<T>
  : [T] extends [readonly Source[]]
  ? ArrayVal<T>
  : [T] extends [SourcePrimitive]
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
