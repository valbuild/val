import { Selector } from ".";
import { SourcePrimitive } from "../Source";
import { SourcePath } from "../val";

function hasOwn<T extends PropertyKey>(obj: object, prop: T): boolean {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

function andThen(f: (...args: any[]) => any, source: any, path?: SourcePath) {
  if (source) {
    return f(newSelector(source, path));
  }
  return newSelector(source, path);
}

function newSelector(source: any, path?: SourcePath): any {
  switch (typeof source) {
    case "function":
    case "symbol":
      throw Error(`Invalid selector type: ${typeof source}`);
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
            if (prop === "andThen") {
              return (f: any) => andThen(f, source, path);
            }
            if (Array.isArray(target) && prop === "length") {
              return target.length;
            }
            const reflectedValue = Reflect.get(target, prop);
            if (hasOwn(source, prop)) {
              return newSelector(
                reflectedValue,
                path && (`${path}.${prop}` as SourcePath)
              );
            }
            return reflectedValue;
          },
        });
      }
    // intentional fallthrough
    // eslint-disable-next-line no-fallthrough
    default:
      return {
        eq: (other: SourcePrimitive) => {
          return newSelector(source === other, undefined);
        },
        andThen: (f: any) => {
          return andThen(f, source, path);
        },
        valPath: path,
        val: source,
      };
  }
}

describe("todo", () => {
  test("todo 1", () => {
    const string1 = newSelector("foo") as Selector<string>;
    console.log(string1.eq("foo").andThen((v) => v));
  });
});
