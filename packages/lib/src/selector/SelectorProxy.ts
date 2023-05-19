import { Path, GenericSelector, SourceOrExpr, GetSchema } from ".";
import { Expr } from "../expr/expr";
import { Schema } from "../schema";
import { Source, SourcePrimitive } from "../source";
import { isSerializedVal, SourcePath } from "../val";

function hasOwn<T extends PropertyKey>(obj: object, prop: T): boolean {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

function andThen(f: (...args: any[]) => any, source: any, path?: SourcePath) {
  if (source) {
    return newSelectorProxy(f(newSelectorProxy(source, path)));
  }
  return newSelectorProxy(source, path);
}

export function isSelector(source: any): source is GenericSelector<Source> {
  return (
    typeof source === "object" &&
    source !== null &&
    (SourceOrExpr in source || Path in source)
  );
}

export function newSelectorProxy(
  source: any,
  path?: SourcePath,
  moduleSchema?: any
): any {
  if (typeof source === "object") {
    if (source !== null && SourceOrExpr in source) {
      // already a Selector
      return source;
    } else if (isSerializedVal(source)) {
      return newSelectorProxy(source.val, source.valPath);
    }
  }

  switch (typeof source) {
    case "function":
    case "symbol":
      throw Error(`Invalid selector type: ${typeof source}: ${source}`);
    case "object":
      // Handles both objects and arrays!
      if (source !== null) {
        return new Proxy(source, {
          // TODO: see proxy docs if we want more traps
          has(target, prop: string | symbol) {
            if (prop === SourceOrExpr) {
              return true;
            }
            if (prop === Path) {
              return true;
            }
            if (prop === "andThen") {
              return true;
            }
            if (prop === GetSchema) {
              return true;
            }
            return prop in target;
          },
          get(target, prop: string | symbol) {
            if (prop === SourceOrExpr) {
              return source;
            }
            if (prop === Path) {
              return path;
            }
            if (prop === GetSchema) {
              return moduleSchema;
            }
            if (prop === "andThen") {
              return (f: any) => andThen(f, source, path);
            }
            if (Array.isArray(target)) {
              if (prop === "filter") {
                return (f: any) => {
                  const filtered = target
                    .map((a, i) =>
                      newSelectorProxy(a, createValPathOfArrayItem(path, i))
                    )
                    .filter((a) => {
                      if (f && f instanceof Schema<Source>) {
                        return f.match(unValify(a));
                      } else {
                        return unValify(f(a));
                      }
                    });
                  return newSelectorProxy(filtered, path);
                };
              } else if (prop === "map") {
                return (f: any) => {
                  const filtered = target.map((a, i) => {
                    const valueOrSelector = f(
                      newSelectorProxy(a, createValPathOfArrayItem(path, i)),
                      newSelectorProxy(i)
                    );
                    if (
                      typeof valueOrSelector === "object" &&
                      SourceOrExpr in valueOrSelector
                    ) {
                      return valueOrSelector;
                    }
                    return newSelectorProxy(valueOrSelector);
                  });
                  return newSelectorProxy(filtered, path);
                };
              }
            }
            if (Array.isArray(target) && prop === "length") {
              return newSelectorProxy(target.length);
            }
            const reflectedValue = Reflect.get(target, prop);

            if (hasOwn(source, prop)) {
              if (!Number.isNaN(Number(prop))) {
                return newSelectorProxy(
                  reflectedValue,
                  createValPathOfArrayItem(path, Number(prop))
                );
              }
              return newSelectorProxy(
                reflectedValue,
                createValPathOfArrayItem(path, prop)
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
        eq: (other: SourcePrimitive | GenericSelector<Source>) => {
          let otherValue: any = other;
          if (isSelector(other)) {
            otherValue = other[SourceOrExpr];
            if (otherValue instanceof Expr) {
              throw Error("TODO: Cannot evaluate equality with an Expr");
            }
          }
          return newSelectorProxy(source === otherValue, undefined);
        },
        andThen: (f: any) => {
          return andThen(f, source === undefined ? null : source, path);
        },
        [SourceOrExpr]: source === undefined ? null : source,
        [Path]: path,
      };
  }
}

function selectorAsVal(sel: any): any {
  if (isSerializedVal(sel)) {
    // is a serialized val
    return selectorAsVal(newSelectorProxy(sel.val, sel.valPath));
  } else if (
    typeof sel === "object" &&
    sel &&
    !(SourceOrExpr in sel) &&
    !Array.isArray(sel)
  ) {
    // is object
    return Object.fromEntries(
      Object.entries(sel).map(([k, v]) => [k, selectorAsVal(v)])
    );
  } else if (
    typeof sel === "object" &&
    sel &&
    !(SourceOrExpr in sel) &&
    Array.isArray(sel)
  ) {
    // is array
    return sel.map((v) => selectorAsVal(v));
  } else if (
    typeof sel === "object" &&
    sel &&
    (SourceOrExpr in sel || Path in sel)
  ) {
    return selectorAsVal(sel?.[SourceOrExpr]);
  } else if (sel === undefined) {
    return null;
  }
  return sel;
}

export function createValPathOfArrayItem(
  arrayPath: SourcePath | undefined,
  prop: string | number | symbol
) {
  if (typeof prop === "symbol") {
    throw Error(
      `Cannot create val path of array item with symbol prop: ${prop.toString()}`
    );
  }
  return arrayPath && (`${arrayPath}.${JSON.stringify(prop)}` as SourcePath);
}

export function selectorToVal(s: any): any {
  const v = selectorAsVal(s?.[SourceOrExpr]);
  return {
    val: v,
    [Path]: s?.[Path],
  };
}

// TODO: could we do .val on the objects instead?
function unValify(valueOrSelector: any) {
  if (
    typeof valueOrSelector === "object" &&
    (SourceOrExpr in valueOrSelector || Path in valueOrSelector)
  ) {
    const selectorValue = valueOrSelector[SourceOrExpr];
    return selectorValue;
  }
  return valueOrSelector;
}
