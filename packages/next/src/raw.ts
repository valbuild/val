import { type RawString } from "@valbuild/core";
import { ValEncodedString, stegaClean } from "@valbuild/react/stega";

export type DecodeValEncodedString<T> = T extends ValEncodedString | RawString
  ? string
  : T extends { [key: string]: unknown }
    ? { [K in keyof T]: DecodeValEncodedString<T[K]> }
    : T extends Array<infer U>
      ? DecodeValEncodedString<U>[]
      : T;

export function raw<T>(val: T): DecodeValEncodedString<T> {
  if (typeof val === "string") {
    return stegaClean(val) as DecodeValEncodedString<T>;
  }
  if (Array.isArray(val)) {
    return val.map((item) => raw(item)) as DecodeValEncodedString<T>;
  }
  if (typeof val === "object" && val !== null) {
    const result: Record<string, unknown> = {};
    for (const key in val) {
      if (Object.prototype.hasOwnProperty.call(val, key)) {
        result[key] = raw(val[key]);
      }
    }
    return result as DecodeValEncodedString<T>;
  }
  return val as DecodeValEncodedString<T>;
}
