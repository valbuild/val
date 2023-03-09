import { array, result } from "../fp";
import { JSONValue, PatchError } from "./ops";

export function isNotRoot(path: string[]): path is array.NonEmptyArray<string> {
  return array.isNonEmpty(path);
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
      const aEntries = Object.entries(a);
      // If the objects have a different amount of keys, they cannot be equal
      if (aEntries.length !== Object.keys(b).length) return false;

      for (const [key, aValue] of aEntries) {
        // b must be a JSON object, so the only way for the bValue to be
        // undefined is if the key is unset
        const bValue: JSONValue | undefined = b[key];
        if (bValue === undefined) return false;
        if (!deepEqual(aValue, bValue)) return false;
      }
      return true;
    }
  }

  return false;
}

export function deepClone<T extends JSONValue>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(deepClone) as T;
  } else if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, value]) => [key, deepClone(value)])
    ) as T;
  } else {
    return value;
  }
}

export function parseAndValidateArrayIndex(
  value: string
): result.Result<number, PatchError> {
  if (!/^(0|[1-9][0-9]*)$/g.test(value)) {
    return result.err(new PatchError(`Invalid array index "${value}"`));
  }
  return result.ok(Number(value));
}
