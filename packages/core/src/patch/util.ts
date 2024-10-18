import { array, result } from "../fp";
import { PatchError, ReadonlyJSONValue, ToMutable } from "./ops";
import { splitModuleFilePathAndModulePath } from "../module";
import { SourcePath } from "../val";

export function isNotRoot(path: string[]): path is array.NonEmptyArray<string> {
  return array.isNonEmpty(path);
}

export function deepEqual(a: ReadonlyJSONValue, b: ReadonlyJSONValue) {
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
        const bValue: ReadonlyJSONValue | undefined = (
          b as { readonly [P in string]: ReadonlyJSONValue }
        )[key];
        if (bValue === undefined) return false;
        if (!deepEqual(aValue, bValue)) return false;
      }
      return true;
    }
  }

  return false;
}

export function deepClone<T extends ReadonlyJSONValue>(value: T): ToMutable<T> {
  if (Array.isArray(value)) {
    return value.map(deepClone) as ToMutable<T>;
  } else if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, value]) => [key, deepClone(value)]),
    ) as ToMutable<T>;
  } else {
    return value as ToMutable<T>;
  }
}

export function parseAndValidateArrayIndex(
  value: string,
): result.Result<number, PatchError> {
  if (!/^(0|[1-9][0-9]*)$/g.test(value)) {
    return result.err(new PatchError(`Invalid array index "${value}"`));
  }
  return result.ok(Number(value));
}

export function sourceToPatchPath(sourcePath: SourcePath) {
  const [, modulePath] = splitModuleFilePathAndModulePath(sourcePath);
  return modulePath.split(".").map((p) => JSON.parse(p).toString());
}
