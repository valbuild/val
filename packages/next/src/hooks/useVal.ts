import {
  GenericSelector,
  Json,
  SelectorOf,
  SelectorSource,
  Val,
  Internal,
  FileSource,
  RemoteSource,
  Source,
  SourceObject,
} from "@valbuild/core";
import { JsonPrimitive } from "@valbuild/core/src/Json";
import { SourceArray } from "@valbuild/core/src/source";
import { I18nSource } from "@valbuild/core/src/source/i18n";
import { useVal as useReactVal } from "@valbuild/react";
import { vercelStegaCombine } from "@vercel/stega";

declare const brand: unique symbol;

/**
 * ValEncodedString is a string that is encoded using steganography.
 *
 * This means that there is a hidden / non-visible object embedded in the string.
 * This object includes a path, which is used to automatically tag
 * where the content comes from for contextual editing.
 *
 */
export type ValEncodedString = string & {
  [brand]: "ValEncodedString";
};

type StegaOfSource<T extends Source> = Json extends T
  ? Json
  : T extends I18nSource<readonly string[], infer U>
  ? StegaOfSource<U>
  : T extends RemoteSource<infer U>
  ? StegaOfSource<U>
  : T extends FileSource
  ? { url: ValEncodedString }
  : T extends SourceObject
  ? {
      [key in keyof T]: StegaOfSource<T[key]>;
    }
  : T extends SourceArray
  ? StegaOfSource<T[number]>[]
  : T extends string
  ? ValEncodedString
  : T extends JsonPrimitive
  ? T
  : never;

export function useVal<T extends SelectorSource>(
  selector: T,
  locale?: string
): SelectorOf<T> extends GenericSelector<infer S> ? StegaOfSource<S> : never {
  return stegaEncodeVal(
    useReactVal(selector, locale)
  ) as SelectorOf<T> extends GenericSelector<infer S>
    ? StegaOfSource<S>
    : never;
}

function stegaEncodeVal<T extends Json>(val: Val<T>): T {
  if (typeof val.val === "object") {
    if (Array.isArray(val)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return val.map(stegaEncodeVal) as any;
    }

    return Object.fromEntries(
      Object.entries(val).map(([key, value]) => [key, stegaEncodeVal(value)])
    ) as T;
  }
  if (typeof val.val === "string") {
    return vercelStegaCombine(val.val, {
      origin: "app.val.build",
      data: { valPath: Internal.getValPath(val) },
    }) as T;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return val.val as any;
}
