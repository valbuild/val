export type CompositeVal<T> = Omit<
  {
    [key in keyof T]: Val<T[key]>;
  },
  "valId" | "val"
> & {
  readonly valId: string;
  readonly val: T;
};
export type PrimitiveVal<T> = {
  valId: string;
  val: T;
};
export type Val<T> = [T] extends [object] ? CompositeVal<T> : PrimitiveVal<T>;

function hasOwn<T extends PropertyKey>(obj: object, prop: T): boolean {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

export function newVal<T>(id: string, val: T): Val<T> {
  switch (typeof val) {
    case "function":
    case "symbol":
      throw Error("Invalid val type");
    case "object":
      if (val !== null) {
        // Handles both objects and arrays!
        return new Proxy(val, {
          get(target, prop: string) {
            if (prop === "valId") {
              return id;
            }
            if (prop === "val") {
              return target;
            }
            if (Array.isArray(target) && prop === "length") {
              return target.length;
            }
            if (hasOwn(val, prop)) {
              return newVal(`${id}.${prop}`, Reflect.get(target, prop));
            }
            return Reflect.get(target, prop);
          },
        }) as Val<T>;
      }
    // intentional fallthrough
    // eslint-disable-next-line no-fallthrough
    default:
      return {
        valId: id,
        val,
      } as Val<T>;
  }
}
