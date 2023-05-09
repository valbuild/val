import { SelectorC, VAL_OR_EXPR } from ".";
import { Expr } from "../expr/expr";
import { Schema } from "../schema";
import { Source, SourcePrimitive } from "../Source";
import { SourcePath, Val } from "../val";

function hasOwn<T extends PropertyKey>(obj: object, prop: T): boolean {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

function andThen(f: (...args: any[]) => any, source: any, path?: SourcePath) {
  if (source) {
    return newSelectorProxy(f(newSelectorProxy(source, path)));
  }
  return newSelectorProxy(source, path);
}

export function newSelectorProxy(source: any, path?: SourcePath): any {
  if (typeof source === "object") {
    if (source === null) {
      throw Error('Invalid selector type: "null"');
    } else if (VAL_OR_EXPR in source) {
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
            if (prop === "andThen") {
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
                  const filtered = target
                    .map((a, i) =>
                      newSelectorProxy(
                        a,
                        path && (`${path}.${i}` as SourcePath)
                      )
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

function stripVal(val: any): any {
  if (typeof val === "object" && val && "val" in val) {
    return stripVal(val.val);
  } else if (
    typeof val === "object" &&
    val &&
    !(VAL_OR_EXPR in val) &&
    !Array.isArray(val)
  ) {
    return Object.fromEntries(
      Object.entries(val).map(([k, v]) => [k, stripVal(v)])
    );
  } else if (
    typeof val === "object" &&
    val &&
    !(VAL_OR_EXPR in val) &&
    Array.isArray(val)
  ) {
    return val.map((v) => stripVal(v));
  } else if (typeof val === "object" && val && VAL_OR_EXPR in val) {
    return stripVal(val?.[VAL_OR_EXPR]()?.val);
  } else if (val === null) {
    // We acknowledge that this is a Wat!?!?! moment, however...
    // Remote selectors cannot have undefined values since they are not part of JSON, so they must operate on null,
    // We want undefined instead of nulls, because the return type of an empty object/array lookup is undefined
    // Therefore, this is the deal, at type level, Source and SelectorSource only accepts undefined.
    // When serializing to JSON, we convert undefined to null, then back here.
    // TODO: we should do this after parsing instead of here
    return undefined;
  }
  return val;
}

export function selectorToVal(s: any): any {
  const v = stripVal(s?.[VAL_OR_EXPR]()?.val);
  return {
    val: v,
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
