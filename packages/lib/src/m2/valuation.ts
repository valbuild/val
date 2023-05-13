import {
  GenericSelector,
  Path,
  Selector,
  SelectorOf,
  SelectorSource,
  SourceOf,
  SourceOrExpr,
} from "./selector";
import { Source } from "../Source";
import {
  isSerializedVal,
  JsonOfSource,
  SerializedVal,
  SourcePath,
  Val,
} from "./val";
import {
  createValPathOfArrayItem,
  isSelector,
  newSelectorProxy,
} from "./selector/SelectorProxy";
import { S } from "ts-toolbelt";
import { Json } from "./Json";

export function valuation<T extends SelectorSource>(
  selector: T,
  locale?: string
): SelectorOf<T> extends GenericSelector<infer S>
  ? Promise<Val<JsonOfSource<S>>>
  : never {
  return Promise.resolve(
    newValProxy(serializedValOfSelectorSource(selector))
  ) as SelectorOf<T> extends GenericSelector<infer S>
    ? Promise<Val<JsonOfSource<S>>>
    : never;
}

function isArrayOrArraySelector(child: any) {
  if (isSelector(child)) {
    return (
      typeof child[SourceOrExpr] === "object" &&
      typeof child[SourceOrExpr] !== null &&
      Array.isArray(child[SourceOrExpr])
    );
  }
  return Array.isArray(child);
}

function isObjectOrObjectSelector(child: any) {
  if (isSelector(child)) {
    return (
      typeof child[SourceOrExpr] === "object" &&
      typeof child[SourceOrExpr] !== null &&
      !Array.isArray(child[SourceOrExpr])
    );
  }
  return typeof child === "object";
}

export function serializedValOfSelectorSource<T extends SelectorSource>(
  selector: T
) {
  const wrappedSelector = newSelectorProxy(selector); // NOTE: we do this if call-site uses a literal with selectors inside
  function rec(child: any): any {
    const isArray = isArrayOrArraySelector(child);
    const isObject = isObjectOrObjectSelector(child);
    if (isArray) {
      const array = (
        SourceOrExpr in child ? child[SourceOrExpr] : child
      ) as Array<unknown>;
      const valPath = Path in child ? (child[Path] as SourcePath) : undefined;
      return {
        val: array.map((item, i) =>
          rec(
            isSelector(item) // NOTE: We do this since selectors currently do not create selectors of items unless specifically required.
              ? item
              : newSelectorProxy(
                  item,
                  createValPathOfArrayItem(valPath, i.toString())
                )
          )
        ),
        valPath,
      };
    } else if (isObject) {
      const obj = (
        SourceOrExpr in child ? child[SourceOrExpr] : child
      ) as object;
      const valPath = Path in child ? (child[Path] as SourcePath) : undefined;
      return {
        val: Object.fromEntries(
          Object.entries(obj).map(([key, value]) => [
            key,
            rec(
              isSelector(value) // NOTE: We do this since selectors currently do not create selectors of items unless specifically required.
                ? value
                : newSelectorProxy(
                    value,
                    createValPathOfArrayItem(valPath, key)
                  )
            ),
          ])
        ),
        valPath,
      };
    } else if (isSelector(child)) {
      return {
        val: rec(child[SourceOrExpr]),
        valPath: child[Path],
      };
    } else {
      return child;
    }
  }

  return rec(wrappedSelector);
}

function strip(value: SerializedVal | Json): Json {
  const val = isSerializedVal(value) ? value.val : value;
  switch (typeof val) {
    case "function":
    case "symbol":
      throw Error(`Invalid val type: ${typeof val}`);
    case "object":
      if (val === null) {
        return null;
      } else if (Array.isArray(val)) {
        return val.map(strip);
      } else {
        return Object.fromEntries(
          Object.entries(val).map(([key, value]) => [
            key,
            value && strip(value),
          ])
        ) as Json;
      }
    // intentional fallthrough
    // eslint-disable-next-line no-fallthrough
    default:
      return val;
  }
}

function newValProxy<T extends Json>(val: SerializedVal): Val<T> {
  const source = val.val;
  switch (typeof source) {
    case "function":
    case "symbol":
      throw Error(`Invalid val type: ${typeof source}`);
    case "object":
      if (source !== null) {
        // Handles both objects and arrays!
        return new Proxy(source, {
          get(target, prop: string) {
            if (prop === "valPath") {
              return val.valPath;
            }
            if (prop === "val") {
              return strip(val);
            }
            if (Array.isArray(target) && prop === "length") {
              return target.length;
            }
            if (hasOwn(source, prop)) {
              return newValProxy<Source>(
                Reflect.get(target, prop) as SerializedVal
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
        [Path]: val.valPath,
        val: val.val,
      } as Val<T>;
  }
}

function hasOwn<T extends PropertyKey>(obj: object, prop: T): boolean {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}
