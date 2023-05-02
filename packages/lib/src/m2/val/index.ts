import { Source, SourceObject, SourcePrimitive } from "../Source";
import { Val as ObjectVal } from "./object";
import { Val as ArrayVal } from "./array";
import { Val as PrimitiveVal } from "./primitive";

export type Val<T extends Source> = [T] extends [SourceObject]
  ? ObjectVal<T>
  : [T] extends [readonly Source[]]
  ? ArrayVal<T>
  : [T] extends [SourcePrimitive]
  ? PrimitiveVal<T>
  : never;

function hasOwn<T extends PropertyKey>(obj: object, prop: T): boolean {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

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

export function newVal<T extends Source>(path: SourcePath, source: T): Val<T> {
  switch (typeof source) {
    case "function":
    case "symbol":
      throw Error("Invalid val type");
    case "object":
      if (source !== null) {
        // Handles both objects and arrays!
        return new Proxy(source, {
          get(target, prop: string) {
            if (prop === "valPath") {
              return path;
            }
            if (prop === "val") {
              return target;
            }
            if (Array.isArray(target) && prop === "length") {
              return target.length;
            }
            if (hasOwn(source, prop)) {
              return newVal<Source>(
                `${path}.${JSON.stringify(prop)}` as SourcePath,
                Reflect.get(target, prop) as Source
              );
            }
            return Reflect.get(target, prop);
          },
        }) as unknown as Val<T>;
      }
    // intentional fallthrough
    // eslint-disable-next-line no-fallthrough
    default:
      return {
        valPath: path,
        val: source,
      } as unknown as Val<T>;
  }
}
