import { type RawString } from "@valbuild/core";
import { ValEncodedString, stegaClean } from "@valbuild/react/stega";

export type DecodeVal<T> = T extends ValEncodedString | RawString
  ? string
  : T extends { [key: string]: unknown }
    ? { [K in keyof T]: DecodeVal<T[K]> }
    : T extends Array<infer U>
      ? DecodeVal<U>[]
      : T;

export function raw<T>(val: T): DecodeVal<T> {
  if (typeof val === "string") {
    return stegaClean(val) as DecodeVal<T>;
  }
  if (Array.isArray(val)) {
    return val.map((item) => raw(item)) as DecodeVal<T>;
  }
  if (typeof val === "object" && val !== null) {
    const result: Record<string, unknown> = {};
    for (const key in val) {
      if (Object.prototype.hasOwnProperty.call(val, key)) {
        result[key] = raw(val[key]);
      }
    }
    return result as DecodeVal<T>;
  }
  return val as DecodeVal<T>;
}
