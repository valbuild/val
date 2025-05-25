import { type RawString } from "@valbuild/core";
import { ValEncodedString, stegaClean } from "@valbuild/react/stega";

export type DecodeVal<T> = T extends ValEncodedString | RawString
  ? string
  : // Avoid using (...args: DecodeVal<P>) => DecodeVal<R> since this means that the function signature is harder to read
    // for at least 5 arguments, then we fallback to the generic case
    // Eg. you get `(...args: string[]) => string` instead of `(a: string) => string`
    T extends (a: infer A) => infer R
    ? (a: DecodeVal<A>) => DecodeVal<R>
    : T extends (a: infer A, b: infer B) => infer R
      ? (a: DecodeVal<A>, b: DecodeVal<B>) => DecodeVal<R>
      : T extends (a: infer A, b: infer B, c: infer C) => infer R
        ? (a: DecodeVal<A>, b: DecodeVal<B>, c: DecodeVal<C>) => DecodeVal<R>
        : T extends (a: infer A, b: infer B, c: infer C, d: infer D) => infer R
          ? (
              a: DecodeVal<A>,
              b: DecodeVal<B>,
              c: DecodeVal<C>,
              d: DecodeVal<D>,
            ) => DecodeVal<R>
          : T extends (
                a: infer A,
                b: infer B,
                c: infer C,
                d: infer D,
                e: infer E,
              ) => infer R
            ? (
                a: DecodeVal<A>,
                b: DecodeVal<B>,
                c: DecodeVal<C>,
                d: DecodeVal<D>,
                e: DecodeVal<E>,
              ) => DecodeVal<R>
            : // Fallback for more than 5 arguments
              T extends (...args: infer P) => infer R
              ? (...args: DecodeVal<P>) => DecodeVal<R>
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
