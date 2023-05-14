import { Val as ObjectVal } from "./object";
import { Val as ArrayVal } from "./array";
import { Val as PrimitiveVal } from "./primitive";
import { Json, JsonObject, JsonArray, JsonPrimitive } from "../Json";

/**
 *  @internal
 */
export const Path = Symbol("Path");
export type Val<T extends Json> = Json extends T
  ? {
      readonly [Path]: PathSegments;
      readonly val: T;
    }
  : T extends JsonObject
  ? ObjectVal<T>
  : T extends JsonArray
  ? ArrayVal<T>
  : T extends JsonPrimitive
  ? PrimitiveVal<T>
  : never;

/**
 *  @internal
 */
const PathSegments = Symbol("PathSegments");
/**
 * The path of the source value.
 *
 * @example
 * ["app/blogs","0","text"] // the text property of the first element of the /app/blogs module
 */
export type PathSegments = ([string, ...[]] | undefined) & {
  [PathSegments]: "PathSegments";
};
