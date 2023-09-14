import {
  GenericSelector,
  Path,
  SelectorOf,
  SelectorSource,
  GetSource,
} from "./selector";
import {
  isSerializedVal,
  JsonOfSource,
  SerializedVal,
  SourcePath,
  Val,
} from "./val";
import {
  createValPathOfItem,
  isSelector,
  newSelectorProxy,
} from "./selector/SelectorProxy";
import { Json } from "./Json";

export function fetchVal<T extends SelectorSource>(
  selector: T
): SelectorOf<T> extends GenericSelector<infer S>
  ? Promise<Val<JsonOfSource<S>>>
  : never {
  return Promise.resolve(
    getVal(selector) as unknown
  ) as SelectorOf<T> extends GenericSelector<infer S>
    ? Promise<Val<JsonOfSource<S>>>
    : never;
}

export function getVal<T extends SelectorSource>(
  selector: T
): SelectorOf<T> extends GenericSelector<infer S>
  ? Val<JsonOfSource<S>>
  : never {
  return newValProxy(
    serializedValOfSelectorSource(selector)
  ) as SelectorOf<T> extends GenericSelector<infer S>
    ? Val<JsonOfSource<S>>
    : never;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isArrayOrArraySelector(child: any) {
  if (isSelector(child)) {
    return (
      typeof child[GetSource] === "object" &&
      typeof child[GetSource] !== null &&
      Array.isArray(child[GetSource])
    );
  }
  return Array.isArray(child);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isObjectOrObjectSelector(child: any) {
  if (isSelector(child)) {
    return (
      typeof child[GetSource] === "object" &&
      typeof child[GetSource] !== null &&
      !Array.isArray(child[GetSource])
    );
  }
  return typeof child === "object";
}

export function serializedValOfSelectorSource<T extends SelectorSource>(
  selector: T
) {
  const wrappedSelector = newSelectorProxy(selector); // NOTE: we do this if call-site uses a literal with selectors inside
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function rec(child: any): any {
    const isArray = isArrayOrArraySelector(child);
    const isObject = isObjectOrObjectSelector(child);
    if (isArray) {
      const array = (
        GetSource in child ? child[GetSource] : child
      ) as Array<unknown>;
      const valPath = Path in child ? (child[Path] as SourcePath) : undefined;
      return {
        val: array.map((item, i) =>
          rec(
            isSelector(item) // NOTE: We do this since selectors currently do not create selectors of items unless specifically required.
              ? item
              : newSelectorProxy(item, createValPathOfItem(valPath, i))
          )
        ),
        valPath,
      };
    } else if (isObject) {
      const obj = (GetSource in child ? child[GetSource] : child) as object;
      const valPath = Path in child ? (child[Path] as SourcePath) : undefined;
      return {
        val:
          obj !== null &&
          Object.fromEntries(
            Object.entries(obj).map(([key, value]) => [
              key,
              rec(
                isSelector(value) // NOTE: We do this since selectors currently do not create selectors of items unless specifically required.
                  ? value
                  : newSelectorProxy(value, createValPathOfItem(valPath, key))
              ),
            ])
          ),
        valPath,
      };
    } else if (isSelector(child)) {
      return {
        val: rec(child[GetSource]),
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
          has(target, prop: string | symbol) {
            if (prop === "val") {
              return true;
            }
            if (prop === Path) {
              return true;
            }
            return hasOwn(target, prop);
          },
          get(target, prop: string | symbol) {
            if (prop === Path) {
              return val.valPath;
            }
            if (prop === "val") {
              return strip(val);
            }
            if (Array.isArray(target) && prop === "length") {
              return target.length;
            }
            if (hasOwn(source, prop)) {
              return newValProxy({
                val: Reflect.get(target, prop).val,
                valPath:
                  Reflect.get(target, prop)?.valPath ??
                  createValPathOfItem(
                    val.valPath,
                    Array.isArray(target) ? Number(prop) : prop
                  ),
              } as SerializedVal);
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
