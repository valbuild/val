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
import { parseRichTextSource } from "@valbuild/ui";
import { RawString } from "@valbuild/core/src/schema/string";

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
  : T extends RichTextSource<infer O>
  ? RichText<O>
  : T extends FileSource
  ? { url: ValEncodedString }
  : T extends SourceObject
  ? {
      [key in keyof T]: StegaOfSource<T[key]>;
    }
  : T extends SourceArray
  ? StegaOfSource<T[number]>[]
  : T extends RawString
  ? string
  : T extends string
  ? ValEncodedString
  : T extends JsonPrimitive
  ? T
  : never;

export function stegaEncode(
  input: any,
  opts: {
    getModule?: (moduleId: string) => any;
    disabled?: boolean;
  }
): any {
  function rec(
    sourceOrSelector: any,
    recOpts?: { path: any; schema: any }
  ): any {
    if (typeof sourceOrSelector === "object") {
      if (!sourceOrSelector) {
        return null;
      }
      const selectorPath = Internal.getValPath(sourceOrSelector);
      if (selectorPath) {
        const newSchema = Internal.getSchema(sourceOrSelector);
        return rec(
          (opts.getModule && opts.getModule(selectorPath)) ||
            Internal.getSource(sourceOrSelector),
          opts.disabled ? undefined : { path: selectorPath, schema: newSchema }
        );
      }

      if (VAL_EXTENSION in sourceOrSelector) {
        if (sourceOrSelector[VAL_EXTENSION] === "richtext") {
          if (recOpts?.path) {
            return {
              ...parseRichTextSource(sourceOrSelector),
              valPath: recOpts.path,
            };
          }

          return parseRichTextSource(sourceOrSelector);
        }

        if (
          sourceOrSelector[VAL_EXTENSION] === "file" &&
          typeof sourceOrSelector[FILE_REF_PROP] === "string"
        ) {
          const fileSelector = Internal.convertFileSource(sourceOrSelector);
          return {
            ...fileSelector,
            url: rec(fileSelector.url, recOpts),
          };
        }
        console.error(
          `Encountered unexpected extension: ${sourceOrSelector[VAL_EXTENSION]}`
        );
        return sourceOrSelector;
      }

      if (Array.isArray(sourceOrSelector)) {
        return sourceOrSelector.map((el, i) =>
          rec(
            el,
            recOpts && {
              path: Internal.createValPathOfItem(recOpts.path, i),
              schema: recOpts.schema.item,
            }
          )
        );
      }

      if (!Array.isArray(sourceOrSelector)) {
        const res: Record<string, any> = {};
        for (const [key, value] of Object.entries(sourceOrSelector)) {
          res[key] = rec(
            value,
            recOpts && {
              path: Internal.createValPathOfItem(recOpts.path, key),
              schema:
                recOpts.schema.item || // Record
                recOpts.schema.items[key], // Object
            }
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
      if (!recOpts) {
        return sourceOrSelector;
      }
      if (recOpts.schema.isRaw) {
        return sourceOrSelector;
      }
      return vercelStegaCombine(
        sourceOrSelector,
        {
          origin: "val.build",
          data: { valPath: recOpts.path },
        },
        false // auto detection on urls and dates is disabled, isDate could be used but it is also disabled (users should use a date schema instead): isDate(sourceOrSelector) // skip = true if isDate
      );
    }

    if (
      typeof sourceOrSelector === "number" ||
      typeof sourceOrSelector === "boolean"
    ) {
      return sourceOrSelector;
    }

    console.error(
      `Unexpected type of source selector: ${typeof sourceOrSelector}`
    );
    return sourceOrSelector;
  }
  return rec(input);
}

export function getModuleIds(input: any): string[] {
  const modules: Set<string> = new Set();
  function rec(sourceOrSelector: any): undefined {
    if (typeof sourceOrSelector === "object") {
      if (!sourceOrSelector) {
        return;
      }
      const selectorPath = Internal.getValPath(sourceOrSelector);
      if (selectorPath) {
        modules.add(selectorPath);
        return;
      }

      if (VAL_EXTENSION in sourceOrSelector) {
        if (sourceOrSelector[VAL_EXTENSION] === "richtext") {
          return;
        }

        if (
          sourceOrSelector[VAL_EXTENSION] === "file" &&
          typeof sourceOrSelector[FILE_REF_PROP] === "string"
        ) {
          return;
        }
        console.error(
          `Encountered unexpected extension: ${sourceOrSelector[VAL_EXTENSION]}`
        );
        return sourceOrSelector;
      }

      if (Array.isArray(sourceOrSelector)) {
        sourceOrSelector.forEach(rec);
        return;
      }

      if (!Array.isArray(sourceOrSelector)) {
        for (const [, value] of Object.entries(sourceOrSelector)) {
          rec(value);
        }
        return;
      }

      console.error(
        `Could not transform source selector: ${typeof sourceOrSelector} (array: ${Array.isArray(
          sourceOrSelector
        )})`,
        sourceOrSelector
      );
      return;
    }

    if (typeof sourceOrSelector === "string") {
      return;
    }

    if (
      typeof sourceOrSelector === "number" ||
      typeof sourceOrSelector === "boolean"
    ) {
      return;
    }

    console.error(
      `Unexpected type of source selector: ${typeof sourceOrSelector}`
    );
    return;
  }
  rec(input);
  return Array.from(modules);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function isDate(s: string) {
  return Boolean(Date.parse(s));
}
