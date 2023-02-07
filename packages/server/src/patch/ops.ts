import * as result from "../fp/result";

export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
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

export function isNotRoot(path: string[]): path is [string, ...string[]] {
  return path.length > 0;
}

export function isProperPathPrefix(prefix: string[], path: string[]): boolean {
  if (prefix.length >= path.length) {
    // A proper prefix cannot be longer or have the same length as the path
    return false;
  }
  for (let i = 0; i < prefix.length; ++i) {
    if (prefix[i] !== path[i]) {
      return false;
    }
  }
  return true;
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
      const aKeys = Object.keys(a).sort();
      {
        const bKeys = Object.keys(b).sort();

        if (aKeys.length !== bKeys.length) return false;
        for (let i = 0; i < aKeys.length; ++i) {
          if (aKeys[i] !== bKeys[i]) return false;
        }
      }

      for (const key of aKeys) {
        const valueA = a[key];
        const valueB = b[key];
        if (!deepEqual(valueA, valueB)) {
          return false;
        }
      }

      return true;
    }
  }

  return false;
}
