/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Json,
  Internal,
  RichTextSource,
  SerializedSchema,
  SerializedRecordSchema,
  SerializedObjectSchema,
  SerializedUnionSchema,
  SerializedLiteralSchema,
  SerializedFileSchema,
  SerializedImageSchema,
  MediaHotspot,
  RichTextOptions,
  ImageSource,
  SerializedDateSchema,
  SerializedDateTimeSchema,
  SerializedColorSchema,
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

/**
 * An image as a consumer sees it: what was authored, plus the generated `url`.
 *
 * `path` stays a plain string — it is what `url` is derived from, so encoding it
 * would corrupt every URL built from it.
 */
export type Image = {
  readonly path: string;
  readonly url: ValEncodedString;
  readonly width?: number;
  readonly height?: number;
  readonly mimeType?: string;
  readonly alt?: string;
  readonly hotspot?: MediaHotspot;
};

export type File = {
  readonly path: string;
  readonly url: ValEncodedString;
  readonly mimeType?: string;
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
> & {
  readonly __brand?: "RichText";
};

export type StegaOfSource<T extends Source> = Json extends T
  ? Json
  : T extends RichTextSource<infer O>
    ? RichText<O>
    : T extends ImageSource
      ? Image
      : T extends FileSource
        ? File
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

/**
 * Resolves the matching sub-schema for a tagged union based on the discriminator key.
 * Returns the matching schema or null if no match is found.
 */
function resolveTaggedUnionSchema(
  source: any,
  schema: SerializedUnionSchema,
): SerializedSchema | null {
  const schemaKey = schema.key;
  if (typeof schemaKey !== "string") {
    return null;
  }

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }

  const key = source[schemaKey];
  if (!key || typeof key !== "string") {
    return null;
  }

  const matchingSchema = (schema.items as any[]).find((s: any) => {
    if (isObjectSchema(s) && s.items && s.items[schemaKey]) {
      const keySchema = s.items[schemaKey];
      if (isLiteralSchema(keySchema)) {
        return keySchema.value === key;
      } else {
        console.warn(
          "Expected literal schema at key in union, but found: ",
          keySchema,
          { key, schema: s },
        );
      }
    } else {
      console.warn("Expected union containing object schema, but found: ", s);
    }
    return false;
  });

  return matchingSchema || null;
}

/**
 * Resolves the matching sub-schema for a literal union (string-based).
 * Returns the matching schema or null if no match is found.
 */
function resolveLiteralUnionSchema(
  source: string,
  schema: SerializedUnionSchema,
): SerializedSchema | null {
  if (typeof schema.key === "string") {
    return null; // Not a literal union
  }

  const matchingSchema = [schema.key]
    .concat(...(schema.items as SerializedLiteralSchema[]))
    .find((s) => {
      if (isLiteralSchema(s)) {
        return s.value === source;
      }
      return false;
    });

  return matchingSchema || null;
}

/**
 * The image schema of a richtext's inline images.
 *
 * `inline.img` serializes as `true` when the author did not pass a schema, so
 * there is nothing to hand down; a bare `{type: "image"}` is enough, since all
 * the media branch needs is to know that it is looking at media.
 */
function inlineImageSchemaOf(
  schema: SerializedSchema | undefined,
): SerializedImageSchema | undefined {
  if (schema?.type !== "richtext") {
    return undefined;
  }
  const img = schema.options?.inline?.img;
  if (!img) {
    return undefined;
  }
  return img === true ? { type: "image", opt: false } : img;
}

/**
 * Handles richtext schema traversal with callback support.
 * Processes richtext structures (string, array, or object format).
 */
function handleRichTextSchema(
  sourceOrSelector: any,
  recOpts: { path: any; schema: any },
  rec: (sourceOrSelector: any, recOpts?: { path: any; schema: any }) => any,
): any {
  if (typeof sourceOrSelector === "string") {
    return rec(sourceOrSelector, {
      path: recOpts.path,
      schema: {
        type: "string",
      },
    });
  }
  if (Array.isArray(sourceOrSelector)) {
    const arraySelector = sourceOrSelector.map((el) =>
      rec(el, {
        path: recOpts.path,
        schema: recOpts.schema,
      }),
    );
    return arraySelector;
  } else if (typeof sourceOrSelector === "object") {
    if (!sourceOrSelector) {
      return null;
    }
    // An inline image's `src` is media, and media is now recognised only from
    // the schema. Passing the richtext schema down (as every other key does)
    // would leave it looking like a plain object, and it would lose its `url`.
    const imgSchema =
      sourceOrSelector.tag === "img"
        ? inlineImageSchemaOf(recOpts.schema)
        : undefined;
    const richtextSelector = Object.fromEntries(
      Object.entries(sourceOrSelector).map(([key, value]) => [
        key,
        key === "tag" || key === "styles"
          ? value
          : rec(value, {
              path: recOpts.path,
              schema: key === "src" && imgSchema ? imgSchema : recOpts.schema,
            }),
      ]),
    );
    return richtextSelector;
  }
  return sourceOrSelector;
}

export function stegaEncode(
  input: any,
  opts: {
    getModule?: (modulePath: string) => any;
    disabled?: boolean;
    /**
     * Seeds the recursion for a RAW source value that is not a selector, so its
     * strings still get edit tags.
     *
     * Needed for a `.jsonValues()` entry loaded by key: its content is plain
     * JSON with no `Path`/`GetSchema` symbols, so the selector branch below
     * cannot fire and — without this — every string hits the `!recOpts` bail in
     * the encoder and the whole call is an identity transform.
     *
     * `path` is the entry's path (`Internal.createValPathOfItem(modulePath, key)`)
     * and `schema` is the SERIALIZED item schema.
     */
    root?: { path: any; schema: any };
  },
): any {
  function rec(
    sourceOrSelector: any,
    recOpts?: { path: any; schema: any },
  ): any {
    if (recOpts?.schema && isKeyOfSchema(recOpts?.schema)) {
      return sourceOrSelector;
    }
    if (recOpts?.schema && isLiteralSchema(recOpts?.schema)) {
      return sourceOrSelector;
    }
    if (recOpts?.schema && isDateSchema(recOpts?.schema)) {
      return sourceOrSelector;
    }
    if (recOpts?.schema && isDateTimeSchema(recOpts?.schema)) {
      return sourceOrSelector;
    }
    if (recOpts?.schema && isColorSchema(recOpts?.schema)) {
      return sourceOrSelector;
    }
    if (recOpts?.schema && isUnionSchema(recOpts?.schema)) {
      // Handle tagged union
      const taggedSchema = resolveTaggedUnionSchema(
        sourceOrSelector,
        recOpts.schema,
      );
      if (taggedSchema) {
        return rec(sourceOrSelector, {
          path: recOpts.path,
          schema: taggedSchema,
        });
      }
      // Handle literal union
      if (typeof sourceOrSelector === "string") {
        const literalSchema = resolveLiteralUnionSchema(
          sourceOrSelector,
          recOpts.schema,
        );
        if (literalSchema) {
          return rec(sourceOrSelector, {
            path: recOpts.path,
            schema: literalSchema,
          });
        }
      }
      // No match found, return as is
      return sourceOrSelector;
    }
    if (recOpts?.schema && isRichTextSchema(recOpts.schema)) {
      return handleRichTextSchema(sourceOrSelector, recOpts, rec);
    }
    if (
      recOpts &&
      (isImageSchema(recOpts.schema) || isFileSchema(recOpts.schema)) &&
      sourceOrSelector &&
      typeof sourceOrSelector === "object"
    ) {
      const src = opts.getModule
        ? Internal.media.fillFromGallery(
            sourceOrSelector,
            recOpts.schema,
            opts.getModule,
          )
        : sourceOrSelector;
      // `url` carries the edit tag, so a click on an image reaches its field.
      // `path` must stay raw: it is what the URL was derived from.
      return {
        ...src,
        url: rec(Internal.mediaUrl(src), recOpts),
      };
    }

    if (typeof sourceOrSelector === "object") {
      if (!sourceOrSelector) {
        return null;
      }
      const selectorPath = Internal.getValPath(sourceOrSelector);
      if (selectorPath) {
        const newSchema = Internal.getSchema(sourceOrSelector);
        return rec(
          opts.getModule && opts.getModule(selectorPath) !== undefined
            ? opts.getModule(selectorPath)
            : Internal.getSource(sourceOrSelector),
          { path: selectorPath, schema: newSchema?.["executeSerialize"]() },
        );
      }

      if (Array.isArray(sourceOrSelector)) {
        return sourceOrSelector.map((el, i) =>
          rec(
            el,
            recOpts && {
              path: Internal.createValPathOfItem(recOpts.path, i),
              schema: recOpts.schema.item,
            },
          ),
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
            },
          );
        }
        return res;
      }

      console.error(
        `Could not transform source selector: ${typeof sourceOrSelector} (array: ${Array.isArray(
          sourceOrSelector,
        )})`,
        sourceOrSelector,
      );
      return sourceOrSelector;
    }

    if (typeof sourceOrSelector === "string") {
      // `disabled` suppresses the steganography, NOT the schema. Media is
      // recognised from the schema now, so dropping it here — which is what
      // this function used to do — would strip `url` from every image on every
      // production page, where `disabled` is the normal case.
      if (!recOpts || opts.disabled) {
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
        false, // auto detection on urls and dates is disabled, isDate could be used but it is also disabled (users should use a date schema instead): isDate(sourceOrSelector) // skip = true if isDate
      );
    }

    if (
      typeof sourceOrSelector === "number" ||
      typeof sourceOrSelector === "boolean"
    ) {
      return sourceOrSelector;
    }

    console.error(
      `Unexpected type of source selector: ${typeof sourceOrSelector}`,
    );
    return sourceOrSelector;
  }
  return rec(input, opts.root);
}

function isRecordSchema(
  schema: SerializedSchema | undefined,
): schema is SerializedRecordSchema {
  return schema?.type === "record";
}

function isLiteralSchema(
  schema: SerializedSchema | undefined,
): schema is SerializedLiteralSchema {
  return schema?.type === "literal";
}

function isDateSchema(
  schema: SerializedSchema | undefined,
): schema is SerializedDateSchema {
  return schema?.type === "date";
}

function isDateTimeSchema(
  schema: SerializedSchema | undefined,
): schema is SerializedDateTimeSchema {
  return schema?.type === "dateTime";
}

function isColorSchema(
  schema: SerializedSchema | undefined,
): schema is SerializedColorSchema {
  return schema?.type === "color";
}

function unknownSchema(schema: unknown) {
  console.debug("Found unknown schema", schema);
  return schema;
}

function isUnionSchema(
  schema: SerializedSchema | undefined,
): schema is SerializedUnionSchema {
  return schema?.type === "union";
}

function isKeyOfSchema(
  schema: SerializedSchema | undefined,
): schema is SerializedUnionSchema {
  return schema?.type === "keyOf";
}

function isRichTextSchema(
  schema: SerializedSchema | undefined,
): schema is SerializedObjectSchema {
  return schema?.type === "richtext";
}

function isObjectSchema(
  schema: SerializedSchema | undefined,
): schema is SerializedObjectSchema {
  return schema?.type === "object";
}

function isFileSchema(
  schema: SerializedSchema | undefined,
): schema is SerializedFileSchema {
  return schema?.type === "file";
}

function isImageSchema(
  schema: SerializedSchema | undefined,
): schema is SerializedImageSchema {
  return schema?.type === "image";
}

function collectReferencedModulesFromSchema(
  schema: SerializedSchema,
  acc: Set<string>,
): void {
  if (isFileSchema(schema) || isImageSchema(schema)) {
    if (schema.referencedModule) {
      acc.add(schema.referencedModule);
    }
  } else if (schema.type === "object") {
    for (const v of Object.values(schema.items)) {
      collectReferencedModulesFromSchema(v, acc);
    }
  } else if (schema.type === "array" || schema.type === "record") {
    collectReferencedModulesFromSchema(schema.item, acc);
  } else if (schema.type === "union") {
    for (const item of schema.items) {
      collectReferencedModulesFromSchema(item, acc);
    }
  }
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
        const schema = Internal.getSchema(sourceOrSelector);
        if (schema) {
          const serialized = schema["executeSerialize"]();
          if (serialized) {
            collectReferencedModulesFromSchema(serialized, modules);
          }
        }
        return;
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
          sourceOrSelector,
        )})`,
        sourceOrSelector,
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
      `Unexpected type of source selector: ${typeof sourceOrSelector}`,
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
