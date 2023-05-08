// TODO: delete this file?

// TODO: cleanup the module dependency cycles, rename index.ts -> Selector.ts and create.ts -> index.ts?

import { SelectorOf, SelectorSource, VAL_OR_EXPR } from ".";
import { SourcePath } from "../val";

export function createSelector<T extends SelectorSource>(
  source: T,
  sourcePath?: SourcePath
): SelectorOf<T> {
  // if (typeof source === "string") {
  //   return new StringSelector(newVal(source, sourcePath)) as Selector<T>;
  // } else if (typeof source === "boolean") {
  //   return new BooleanSelector(newVal(source, sourcePath)) as SelectorOf<T>;
  // } else if (typeof source === "object" && source !== null) {
  //   if (
  //     "_ref" in source &&
  //     "_type" in source &&
  //     "_schema" in source &&
  //     source["_type"] === "remote" &&
  //     source["_schema"] instanceof Schema
  //   ) {
  //     if (source["_schema"] instanceof StringSchema) {
  //       if (!sourcePath) {
  //         throw Error("Cannot create a remote selector without a source path");
  //       }
  //       return new StringSelector(
  //         new expr.Call(
  //           [new expr.Sym("val"), new expr.StringLiteral(sourcePath)],
  //           false
  //         )
  //       ) as SelectorOf<T>;
  //     }
  //   }

  //   if (Array.isArray(source)) {
  //     return new ArraySelector(newVal(source, sourcePath)) as SelectorOf<T>;
  //   }
  // }
  // if (source instanceof SelectorC) {
  //   return source as SelectorOf<T>;
  // }

  throw Error(`Cannot handle ${typeof source}`);
}

function newVal(source: any, path?: SourcePath): any {
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
            const reflectedValue = Reflect.get(target, prop);
            if (hasOwn(source, prop)) {
              if (
                typeof reflectedValue === "object" &&
                VAL_OR_EXPR in reflectedValue &&
                typeof reflectedValue[VAL_OR_EXPR] === "function"
              ) {
                return reflectedValue[VAL_OR_EXPR]();
              }
              return newVal(
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
        valPath: path,
        val: source,
      };
  }
}

function hasOwn<T extends PropertyKey>(obj: object, prop: T): boolean {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}
