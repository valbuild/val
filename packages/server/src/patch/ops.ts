import { isNonEmpty, NonEmptyArray } from "../fp/array";
import * as result from "../fp/result";

export class PatchError {
  constructor(public message: string) {}
}

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | {
      [key: string]: JSONValue;
    };

/**
 * NOTE: MAY mutate the input document.
 */
export interface Ops<T, E> {
  add(
    document: T,
    path: string[],
    value: JSONValue
  ): result.Result<T, E | PatchError>;
  remove(document: T, path: string[]): result.Result<T, E | PatchError>;
  replace(
    document: T,
    path: string[],
    value: JSONValue
  ): result.Result<T, E | PatchError>;
  move(
    document: T,
    from: string[],
    path: string[]
  ): result.Result<T, E | PatchError>;
  copy(
    document: T,
    from: string[],
    path: string[]
  ): result.Result<T, E | PatchError>;
  test(
    document: T,
    path: string[],
    value: JSONValue
  ): result.Result<boolean, E | PatchError>;
}

export function isNotRoot(path: string[]): path is NonEmptyArray<string> {
  return isNonEmpty(path);
}

export function deepEqual(a: JSONValue, b: JSONValue) {
  if (a === b) {
    return true;
  }

  if (
    typeof a === "object" &&
    typeof b === "object" &&
    a !== null &&
    b !== null
  ) {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;

      for (let i = 0; i < a.length; ++i) {
        if (!deepEqual(a[i], b[i])) return false;
      }

      return true;
    } else if (!Array.isArray(a) && !Array.isArray(b)) {
      const aKeys = Object.entries(a);
      // If the objects have a different amount of keys, they cannot be equal
      if (aKeys.length !== Object.keys(b).length) return false;

      for (const [key, aValue] of aKeys) {
        // b must be a JSON object, so the only way for the bValue to be
        // undefined is if the key is unset
        const bValue = b[key] as JSONValue | undefined;
        if (bValue === undefined) return false;
        if (!deepEqual(aValue, bValue)) return false;
      }
      return true;
    }
  }

  return false;
}
