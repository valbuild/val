import { Json, Val, Internal, RichTextSource, RichText } from "@valbuild/core";
import { vercelStegaCombine } from "@vercel/stega";
import { FileSource, RemoteSource, Source, SourceObject } from "@valbuild/core";
import { JsonPrimitive } from "@valbuild/core";
import { SourceArray } from "@valbuild/core";
import { I18nSource } from "@valbuild/core";

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

export type StegaOfSource<T extends Source> = Json extends T
  ? Json
  : T extends I18nSource<readonly string[], infer U>
  ? StegaOfSource<U>
  : T extends RemoteSource<infer U>
  ? StegaOfSource<U>
  : T extends RichTextSource
  ? RichText
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

export function stegaEncodeVal<T extends Json>(val: Val<T>): T {
  if (typeof val.val === "object") {
    if (Array.isArray(val)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return val.map(stegaEncodeVal) as any;
    }

    if (
      typeof val.val === "object" &&
      val.val &&
      "_type" in val.val &&
      val.val["_type"] === "richtext"
    ) {
      return {
        ...val.val,
        valPath: Internal.getValPath(val),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    }

    return Object.fromEntries(
      Object.entries(val).map(([key, value]) => [key, stegaEncodeVal(value)])
    ) as T;
  }
  if (typeof val.val === "string") {
    return vercelStegaCombine(
      val.val,
      {
        origin: "val.build",
        data: { valPath: Internal.getValPath(val) },
      },
      !isDate(val.val)
    ) as T; // TODO: skip should false at least for URLs? Dates...?
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return val.val as any;
}

function isDate(s: string) {
  return Boolean(Date.parse(s));
}
