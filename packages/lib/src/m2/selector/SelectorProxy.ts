import { SelectorC, VAL_OR_EXPR } from ".";
import { Expr } from "../expr/expr";
import { Schema } from "../schema";
import { Source, SourcePrimitive } from "../Source";
import { SourcePath } from "../val";

function hasOwn<T extends PropertyKey>(obj: object, prop: T): boolean {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

function andThen(f: (...args: any[]) => any, source: any, path?: SourcePath) {
  if (source) {
    return f(newSelectorProxy(source, path));
  }
  return newSelectorProxy(source, path);
}

export function newSelectorProxy(source: any, path?: SourcePath): any {
  if (typeof source === "object") {
    if (VAL_OR_EXPR in source) {
      // already a Selector
      return source;
    } else if ("val" in source) {
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
            if (prop === VAL_OR_EXPR) {
              return true;
            }
            return prop in target;
          },
          get(target, prop: string | symbol) {
            if (prop === VAL_OR_EXPR) {
              return () => ({
                valPath: path,
                val: source,
              });
            }
            if (prop === "andThen") {
              return (f: any) => andThen(f, source, path);
            }
            if (Array.isArray(target)) {
              if (prop === "filter") {
                return (f: any) => {
                  const filtered = target.filter((a) => {
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
                      newSelectorProxy(
                        a,
                        path && (`${path}.${i}` as SourcePath)
                      ),
                      newSelectorProxy(i)
                    );
                    if (
                      typeof valueOrSelector === "object" &&
                      VAL_OR_EXPR in valueOrSelector
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
              return newSelectorProxy(
                reflectedValue,
                path && (`${path}.${prop.toString()}` as SourcePath)
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
        eq: (other: SourcePrimitive | SelectorC<Source>) => {
          let otherValue: any = other;
          if (typeof other === "object" && VAL_OR_EXPR in other) {
            const valOrExpr = other[VAL_OR_EXPR]();
            if (valOrExpr instanceof Expr) {
              throw Error("TODO: Cannot evaluate equality with an Expr");
            } else if ("val" in valOrExpr) {
              otherValue = valOrExpr.val;
            } else {
              throw Error("TODO: Cannot evaluate equality with an Expr");
            }
          }
          return newSelectorProxy(source === otherValue, undefined);
        },
        andThen: (f: any) => {
          return andThen(f, source, path);
        },
        [VAL_OR_EXPR]: () => ({
          valPath: path,
          val: source,
        }),
      };
  }
}

export function selectorToVal(s: any): any {
  function stripVal(val: any): any {
    if (Array.isArray(val)) {
      return val.map(stripVal);
    } else if (typeof val === "object" && !(VAL_OR_EXPR in val)) {
      return Object.fromEntries(
        Object.entries(val).map(([k, v]) => [k, stripVal(v)])
      );
    } else if (typeof val === "object" && VAL_OR_EXPR in val) {
      return stripVal(val?.[VAL_OR_EXPR]()?.val);
    }
    return val;
  }
  return {
    val: stripVal(s?.[VAL_OR_EXPR]()?.val),
    valPath: s?.[VAL_OR_EXPR]()?.valPath,
  };
}

function unValify(valueOrSelector: any) {
  if (typeof valueOrSelector === "object" && VAL_OR_EXPR in valueOrSelector) {
    const selectorValue = valueOrSelector[VAL_OR_EXPR]();
    return selectorValue.val;
  }
  return valueOrSelector;
}
