export type CompositeVal<T> = Omit<
  {
    [key in keyof T]: Val<T[key]>;
  },
  "valSource" | "val"
> & {
  readonly valSource: string;
  readonly val: T;
};
export type PrimitiveVal<T> = {
  valSource: string;
  val: T;
};
export type Val<T> = T extends object ? CompositeVal<T> : PrimitiveVal<T>;

function hasOwn<T extends PropertyKey>(obj: object, prop: T): boolean {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

export function newVal<T>(source: string, value: T): Val<T> {
  switch (typeof value) {
    case "function":
    case "symbol":
      throw Error("Invalid val type");
    case "object":
      if (value !== null) {
        // Handles both objects and arrays!
        return new Proxy(value, {
          get(target, prop: string) {
            if (prop === "valSource") {
              return source;
            }
            if (prop === "val") {
              return target;
            }
            if (Array.isArray(target) && prop === "length") {
              return target.length;
            }
            if (hasOwn(value, prop)) {
              return newVal<T[keyof T]>(
                `${source}[${JSON.stringify(prop)}]`,
                Reflect.get(target, prop)
              );
            }
            return Reflect.get(target, prop);
          },
        }) as Val<T>;
      }
    // intentional fallthrough
    // eslint-disable-next-line no-fallthrough
    default:
      return {
        valSource: source,
        val: value,
      } as Val<T>;
  }
}
