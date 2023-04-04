import { Source, SourceObject, SourcePrimitive } from "./Source";

export type ObjectVal<T extends SourceObject> = Omit<
  {
    [key in keyof T]: Val<T[key]>;
  },
  "valSrc" | "val"
> & {
  readonly valSrc: string;
  readonly val: T;
};
export type ArrayVal<T extends readonly Source[]> = Omit<
  {
    [key in keyof T]: Val<T[key]>;
  },
  "valSrc" | "val"
> & {
  readonly valSrc: string;
  readonly val: T;
};
export type PrimitiveVal<T extends SourcePrimitive> = {
  valSrc: string;
  val: T;
};
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
