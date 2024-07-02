/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Json,
  Internal,
  RichTextSource,
  VAL_EXTENSION,
  FILE_REF_PROP,
  SerializedSchema,
  SerializedRecordSchema,
  SerializedObjectSchema,
  SerializedUnionSchema,
  SerializedLiteralSchema,
  ImageMetadata,
  FileMetadata,
  RichTextOptions,
  ImageSource,
} from "@valbuild/core";
import { vercelStegaCombine, vercelStegaSplit } from "@vercel/stega";
import { FileSource, Source, SourceObject } from "@valbuild/core";
import { JsonPrimitive } from "@valbuild/core";
import { SourceArray } from "@valbuild/core";
import { RawString } from "@valbuild/core";

declare const brand: unique symbol;

/**
 * ValEncodedString is a string that is encoded using steganography.
 *
 * This means that there is a hidden / non-visible object embedded in the string.
 * This object includes a path, which is used to automatically tag
 * where the content comes from for contextual editing.
 *
 */
export type ValEncodedString =
  `${string}__VAL_ENCODED_STRING_INVISIBLE_CHARS` & {
    /**
     *
     * NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * Instead, get the raw string using `val.raw`
     *
     * @deprecated NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * @example
     * val.raw(myEncodedString) // returns a normal string
     */
    substring: never;
    /**
     *
     * NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * Instead, get the raw string using `val.raw`
     *
     * @deprecated NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * @example
     * val.raw(myEncodedString) // returns a normal string
     */
    match: never;
    /**
     *
     * NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * Instead, get the raw string using `val.raw`
     *
     * @deprecated NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * @example
     * val.raw(myEncodedString) // returns a normal string
     */
    charAt: never;
    /**
     *
     * NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * Instead, get the raw string using `val.raw`
     *
     * @deprecated NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * @example
     * val.raw(myEncodedString) // returns a normal string
     */
    charCodeAt: never;
    /**
     *
     * NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * Instead, get the raw string using `val.raw`
     *
     * @deprecated NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * @example
     * val.raw(myEncodedString) // returns a normal string
     */
    concat: never;
    /**
     *
     * NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * Instead, get the raw string using `val.raw`
     *
     * @deprecated NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * @example
     * val.raw(myEncodedString) // returns a normal string
     */
    indexOf: never;
    /**
     *
     * NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * Instead, get the raw string using `val.raw`
     *
     * @deprecated NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * @example
     * val.raw(myEncodedString) // returns a normal string
     */
    lastIndexOf: never;
    /**
     *
     * NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * Instead, get the raw string using `val.raw`
     *
     * @deprecated NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * @example
     * val.raw(myEncodedString) // returns a normal string
     */
    slice: never;
    /**
     *
     * NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * Instead, get the raw string using `val.raw`
     *
     * @deprecated NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * @example
     * val.raw(myEncodedString) // returns a normal string
     */
    toString: never;
    /**
     *
     * NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * Instead, get the raw string using `val.raw`
     *
     * @deprecated NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * @example
     * val.raw(myEncodedString) // returns a normal string
     */

    // ---

    /**
     *
     * NB: This is a Val ENCODED string, which means that you should not use length on it.
     *
     * Instead, get the raw string using `val.raw`
     *
     * @deprecated NB: This is a Val ENCODED string, which means that you should not use this method.
     *
     * @example
     * val.raw(myEncodedString) // returns a normal string
     */
    length: never;

    // includes, toLowerCase and toUpperCase should be fine

    [brand]: "ValEncodedString";
  };

export type Image = {
  readonly url: ValEncodedString;
  readonly metadata?: ImageMetadata;
};

export type File<Metadata extends FileMetadata> = {
  readonly url: ValEncodedString;
  readonly metadata?: Metadata;
};

export type StegaOfRichTextSource<T extends Source> = Json extends T
  ? Json
  : T extends ImageSource
  ? Image
  : T extends SourceObject
  ? {
      [key in keyof T]: StegaOfRichTextSource<T[key]>;
    }
  : T extends SourceArray
  ? StegaOfRichTextSource<T[number]>[]
  : T extends JsonPrimitive
  ? T
  : never;

/**
 * RichText is accessible by users (after conversion via useVal / fetchVal)
 **/
export type RichText<O extends RichTextOptions> = StegaOfRichTextSource<
  RichTextSource<O>
> & { valPath: string };

export type StegaOfSource<T extends Source> = Json extends T
  ? Json
  : T extends RichTextSource<infer O>
  ? RichText<O>
  : T extends FileSource<infer M>
  ? M extends ImageMetadata
    ? Image
    : M extends FileMetadata
    ? File<M>
    : never
  : T extends SourceObject
  ? {
      [key in keyof T]: StegaOfSource<T[key]>;
    }
  : T extends SourceArray
  ? StegaOfSource<T[number]>[]
  : T extends RawString
  ? string
  : string extends T
  ? ValEncodedString
  : T extends JsonPrimitive
  ? T
  : never;

export function stegaEncode(
  input: any,
  opts: {
    getModule?: (modulePath: string) => any;
    disabled?: boolean;
  }
): any {
  function rec(
    sourceOrSelector: any,
    recOpts?: { path: any; schema: any }
  ): any {
    if (recOpts?.schema && isKeyOfSchema(recOpts?.schema)) {
      return sourceOrSelector;
    }
    if (recOpts?.schema && isLiteralSchema(recOpts?.schema)) {
      return sourceOrSelector;
    }
    if (recOpts?.schema && isUnionSchema(recOpts?.schema)) {
      if (
        sourceOrSelector &&
        typeof sourceOrSelector === "object" &&
        recOpts.schema.key &&
        typeof recOpts.schema.key === "string"
      ) {
        const key = sourceOrSelector[recOpts.schema.key];
        if (key) {
          const schema = recOpts.schema.items.find((s) => {
            if (isObjectSchema(s) && s.items && s.items[recOpts.schema.key]) {
              const keySchema = s.items[recOpts.schema.key];
              if (isLiteralSchema(keySchema)) {
                return keySchema.value === key;
              } else {
                console.warn(
                  "Expected literal schema at key in , but found: ",
                  keySchema,
                  { key, schema: s }
                );
              }
            } else {
              console.warn(
                "Expected union containing object schema, but found: ",
                s
              );
            }
          });
          if (schema) {
            return rec(sourceOrSelector, {
              path: recOpts.path,
              schema: schema,
            });
          }
        }
        // illegal value, return as is
        return sourceOrSelector;
      }
      if (
        typeof sourceOrSelector === "string" &&
        recOpts.schema.key &&
        typeof recOpts.schema.key !== "string"
      ) {
        return rec(sourceOrSelector, {
          path: recOpts.path,
          schema: [recOpts.schema.key]
            .concat(...recOpts.schema.items)
            .find((s) => {
              if (isLiteralSchema(s)) {
                return s.value === sourceOrSelector;
              }
            }),
        });
      }
    }
    if (recOpts?.schema && isRichTextSchema(recOpts.schema)) {
      const res = rec(sourceOrSelector);
      res.valPath = recOpts.path;
      return res;
    }

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
          opts.disabled
            ? undefined
            : { path: selectorPath, schema: newSchema?.serialize() }
        );
      }

      if (VAL_EXTENSION in sourceOrSelector) {
        if (
          sourceOrSelector[VAL_EXTENSION] === "file" &&
          typeof sourceOrSelector[FILE_REF_PROP] === "string"
        ) {
          const fileSelector = Internal.convertFileSource(sourceOrSelector);
          let url = fileSelector.url;
          if (opts.disabled) {
            url = fileSelector.url;
          } else {
            url = "/api/val/files/public" + fileSelector.url;
          }
          return {
            ...fileSelector,
            url: rec(url, recOpts),
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
        const entries = Object.entries(sourceOrSelector);
        for (const [key, value] of entries) {
          res[key] = rec(
            value,
            recOpts?.schema && {
              path: Internal.createValPathOfItem(recOpts.path, key),
              schema: isRecordSchema(recOpts.schema)
                ? recOpts.schema.item
                : isObjectSchema(recOpts.schema)
                ? recOpts.schema.items[key]
                : unknownSchema(recOpts.schema),
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
      if (recOpts.schema?.raw || recOpts.schema?.type === "literal") {
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

function isRecordSchema(
  schema: SerializedSchema | undefined
): schema is SerializedRecordSchema {
  return schema?.type === "record";
}

function isLiteralSchema(
  schema: SerializedSchema | undefined
): schema is SerializedLiteralSchema {
  return schema?.type === "literal";
}

function unknownSchema(schema: unknown) {
  console.debug("Found unknown schema", schema);
  return schema;
}

function isUnionSchema(
  schema: SerializedSchema | undefined
): schema is SerializedUnionSchema {
  return schema?.type === "union";
}

function isKeyOfSchema(
  schema: SerializedSchema | undefined
): schema is SerializedUnionSchema {
  return schema?.type === "keyOf";
}

function isRichTextSchema(
  schema: SerializedSchema | undefined
): schema is SerializedObjectSchema {
  return schema?.type === "richtext";
}

function isObjectSchema(
  schema: SerializedSchema | undefined
): schema is SerializedObjectSchema {
  return schema?.type === "object";
}

export function stegaClean(source: string) {
  return vercelStegaSplit(source).cleaned;
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
