/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Json,
  Internal,
  RichTextSource,
  RichText,
  VAL_EXTENSION,
  FILE_REF_PROP,
} from "@valbuild/core";
import { vercelStegaCombine } from "@vercel/stega";
import { FileSource, Source, SourceObject } from "@valbuild/core";
import { JsonPrimitive } from "@valbuild/core";
import { SourceArray } from "@valbuild/core";

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

export function transform(input: any): any {
  function rec(sourceOrSelector: any, path?: any): any {
    if (typeof sourceOrSelector === "object") {
      const selectorPath = Internal.getValPath(sourceOrSelector);
      if (selectorPath) {
        return rec(Internal.getSource(sourceOrSelector), selectorPath);
      }

      if (!sourceOrSelector) {
        return null;
      }

      if (VAL_EXTENSION in sourceOrSelector) {
        if (sourceOrSelector[VAL_EXTENSION] === "richtext") {
          return {
            ...sourceOrSelector,
            valPath: path,
          };
        }

        if (
          sourceOrSelector[VAL_EXTENSION] === "file" &&
          typeof sourceOrSelector[FILE_REF_PROP] === "string"
        ) {
          const fileSelector = Internal.convertFileSource(sourceOrSelector);
          return {
            ...fileSelector,
            url: rec(fileSelector.url, path),
          };
        }
        console.error(
          `Encountered unexpected extension: ${sourceOrSelector[VAL_EXTENSION]}`
        );
        return sourceOrSelector;
      }

      if (Array.isArray(sourceOrSelector)) {
        return sourceOrSelector.map((el, i) =>
          rec(el, path && Internal.createValPathOfItem(path, i))
        );
      }

      if (!Array.isArray(sourceOrSelector)) {
        const res: Record<string, any> = {};
        for (const [key, value] of Object.entries(sourceOrSelector)) {
          res[key] = rec(
            value,
            path && Internal.createValPathOfItem(path, key)
          );
        }
        return res;
      }

      console.error(
        `Could not transform source selector: ${typeof sourceOrSelector} (array: ${Array.isArray(
          sourceOrSelector
        )})`,
        sourceOrSelector
      );
      return sourceOrSelector;
    }

    if (typeof sourceOrSelector === "string") {
      return vercelStegaCombine(
        sourceOrSelector,
        {
          origin: "val.build",
          data: { valPath: path },
        },
        isDate(sourceOrSelector) // skip = true if isDate
      );
    }

    console.error(
      `Unexpected type of source selector: ${typeof sourceOrSelector}`
    );
    return sourceOrSelector;
  }
  return rec(input);
}

function isDate(s: string) {
  return Boolean(Date.parse(s));
}
