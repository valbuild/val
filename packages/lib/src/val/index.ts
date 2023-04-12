import { Source, SourceObject, SourcePrimitive } from "../Source";
import { Val as ObjectVal } from "./object";
import { Val as ArrayVal } from "./array";
import { Val as PrimitiveVal } from "./primitive";

export type Val<T extends Source> = Source extends T
  ? {
      readonly valSrc: string;
      readonly val: Source;
    }
  : T extends SourceObject
  ? ObjectVal<T>
  : T extends readonly Source[]
  ? ArrayVal<T>
  : T extends SourcePrimitive
  ? PrimitiveVal<T>
  : never;

function hasOwn<T extends PropertyKey>(obj: object, prop: T): boolean {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

export function newVal<T extends Source>(source: string, value: T): Val<T> {
  switch (typeof value) {
    case "function":
    case "symbol":
      throw Error("Invalid val type");
    case "object":
      if (value !== null) {
        // Handles both objects and arrays!
        return new Proxy(value, {
          get(target, prop: string) {
            if (prop === "valSrc") {
              return source;
            }
            if (prop === "val") {
              return target;
            }
            if (Array.isArray(target) && prop === "length") {
              return target.length;
            }
            if (hasOwn(value, prop)) {
              return newVal<Source>(
                `${source}.${JSON.stringify(prop)}`,
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
        valSrc: source,
        val: value,
      } as Val<T>;
  }
}
