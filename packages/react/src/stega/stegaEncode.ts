/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Json,
  Internal,
  RichTextSource,
  SerializedSchema,
  SerializedRecordSchema,
  SerializedObjectSchema,
  SerializedDiscriminatedUnionSchema,
  SerializedEnumSchema,
  SerializedKeyOfSchema,
  SerializedLiteralSchema,
  SerializedFileSchema,
  SerializedImageSchema,
  MediaHotspot,
  RichTextOptions,
  ImageSource,
  SerializedDateSchema,
  SerializedDateTimeSchema,
  SerializedColorSchema,
  SerializedCodeSchema,
  SerializedLocaleSchema,
} from "@valbuild/core";
import { vercelStegaCombine, vercelStegaSplit } from "@vercel/stega";
import { FileSource, Source, SourceObject } from "@valbuild/core";
import type { ValView, ValViewSource } from "@valbuild/core";
import { isValViewSource } from "@valbuild/core";
import { JsonPrimitive } from "@valbuild/core";
import { SourceArray } from "@valbuild/core";
import { RawString } from "@valbuild/core";
import type {
  GenericSelector,
  JsonSource,
  SelectorOf,
  SelectorSource,
} from "@valbuild/core";

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
        : // A view is a pointer at another module: nothing of it is rendered, so
          // there is nothing here to encode or to read. `ValView<Target>`
          // names what is behind it and exposes no properties.
          T extends ValViewSource<string, infer Target>
          ? ValView<Target>
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
 * What resolving `T` gives back — the one definition the framework readers
 * share.
 *
 * Two shapes go in. A module or selector resolves as it always has. A
 * {@link ValView}, which is what a `s.view()` field reads as, resolves to the
 * module it points at: the page declares what it shows, and a reader follows
 * that declaration instead of importing the target a second time.
 *
 * One definition rather than one per reader — `useVal`, `fetchVal`,
 * `initValContent` and the TanStack client each had their own copy of the
 * selector half, which is four places for the view half to be forgotten in.
 *
 * `Target extends Source` is checked HERE rather than on `ValView` itself:
 * `ValView` is built from `ValViewSource`, which is a member of the `Source`
 * union, so a constraint there is a circular type reference.
 *
 * The outer arms are wrapped in tuples so the conditional does not DISTRIBUTE
 * over a union: distributing it re-entered `StegaOfSource` per member and the
 * async readers hit "Type instantiation is excessively deep and possibly
 * infinite" — `useVal` did not, because a `Promise<...>` around it is one more
 * level than the checker had left.
 */
export type ResolvedVal<T extends SelectorSource> = [T] extends [
  ValView<infer Target>,
]
  ? [Target] extends [Source]
    ? StegaOfSource<Target>
    : never
  : SelectorOf<T> extends GenericSelector<infer S>
    ? StegaOfSource<S>
    : never;

/** What a reader accepts. A view handle is a `SelectorSource`, so this is it. */
export type Resolvable = SelectorSource;

/**
 * The source of whichever arm of `ResolvableModule` a reader was given — the
 * module's own, or that of the module a view points at.
 */
type SourceOfResolvable<T> = [T] extends [ValView<infer Target>]
  ? Target
  : T extends GenericSelector<infer S>
    ? S
    : never;

/**
 * The (loosened) content type a single `.jsonValues()` entry resolves to.
 *
 * Here rather than in the framework packages because there were four identical
 * copies of it — next's client and rsc readers, tanstack's client and server —
 * and the view arm would have had to be added to each. Same reason
 * {@link ResolvedVal} lives here.
 */
export type JsonEntryContentOf<T> =
  SourceOfResolvable<T> extends Record<string, infer V>
    ? V extends JsonSource<infer C>
      ? C
      : never
    : never;

/** What a route reader gives back for the entry the params matched. */
export type RouteValueOf<T> =
  SourceOfResolvable<T> extends SourceObject
    ? // `.jsonValues()` router: the matched entry resolves to its json content.
      NonNullable<SourceOfResolvable<T>>[string] extends JsonSource<infer C>
      ? C | null
      : StegaOfSource<NonNullable<SourceOfResolvable<T>>[string]> | null
    : never;

/**
 * Resolves the matching variant of a discriminated union from the value's tag.
 * Returns the matching schema or null if no match is found.
 */
function resolveDiscriminatedUnionVariant(
  source: any,
  schema: SerializedDiscriminatedUnionSchema,
): SerializedSchema | null {
  const schemaKey = schema.key;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }

  const key = source[schemaKey];
  // The `typeof` check is the whole test: a falsy guard here would drop a
  // variant tagged `s.literal("")`, whose strings would then never be encoded.
  if (typeof key !== "string") {
    return null;
  }

  const matchingSchema = (schema.items as any[]).find((s: any) => {
    if (isObjectSchema(s) && s.items && s.items[schemaKey]) {
      const keySchema = s.items[schemaKey];
      if (isLiteralSchema(keySchema)) {
        return keySchema.value === key;
      } else {
        console.warn(
          "Expected literal schema at key in discriminated union, but found: ",
          keySchema,
          { key, schema: s },
        );
      }
    } else {
      console.warn(
        "Expected discriminated union containing object schema, but found: ",
        s,
      );
    }
    return false;
  });

  return matchingSchema || null;
}

/**
 * The image schema of a richtext's inline images.
 *
 * `img` serializes as `true` when the author did not pass a schema, so
 * there is nothing to hand down; a bare `{type: "image"}` is enough, since all
 * the media branch needs is to know that it is looking at media.
 */
function inlineImageSchemaOf(
  schema: SerializedSchema | undefined,
): SerializedImageSchema | undefined {
  if (schema?.type !== "richtext") {
    return undefined;
  }
  const img = schema.options?.img;
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
  const viewModules = new Map<string, unknown>();
  // Handed a view handle rather than a module: resolve it and encode what it
  // points at. This is what makes `useVal(page.header)` read the header.
  const resolved = Internal.viewHandleModule(input);
  if (resolved !== undefined) {
    return stegaEncode(resolved, opts);
  }
  // A view pointer with no module on it. The module rides on a symbol, and
  // symbols do not survive serialization — so this is a handle that crossed the
  // server/client boundary as a prop, or one read out of raw JSON. Resolving it
  // would hand back the pointer itself, which looks like content and is not, so
  // say what happened instead.
  if (isValViewSource(input)) {
    throw Error(
      `Cannot resolve the view of '${input.view}': it has been serialized, which drops the module it points at. ` +
        `Resolve it in the same component that read the module containing it, or read '${input.view}' directly.`,
    );
  }
  function rec(
    sourceOrSelector: any,
    recOpts?: { path: any; schema: any },
  ): any {
    // A view is a pointer at another module. Weaving an edit tag into it would
    // corrupt the path it holds, and there is nothing of the target here to
    // encode — the target is its own module, encoded when it is read.
    //
    // The module it names rides along on a symbol, so `useVal(page.header)` can
    // resolve it without a path-to-module registry the app does not have. The
    // pointer itself is unchanged: symbols do not serialize, so this is still
    // `{ view: "/foo.val.ts" }` to anything that looks at it as data.
    if (recOpts?.schema && recOpts.schema.type === "view") {
      const valModule = viewModules.get(recOpts.schema.moduleFilePath);
      if (valModule === undefined || !isValViewSource(sourceOrSelector)) {
        return sourceOrSelector;
      }
      return Internal.createViewHandle(sourceOrSelector, valModule);
    }
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
    // Stega weaves invisible characters into the string. In source code they
    // are not invisible: they are syntax errors, or silent corruption in a
    // string literal. So a code value is handed back verbatim.
    if (recOpts?.schema && isCodeSchema(recOpts?.schema)) {
      return sourceOrSelector;
    }
    // A locale ends up in `<html lang>`, in `hreflang`, and in `Intl`
    // constructors. None of those survive invisible characters: the attribute
    // carries them into the markup, and `Intl` throws on a tag it cannot parse.
    if (recOpts?.schema && isLocaleSchema(recOpts?.schema)) {
      return sourceOrSelector;
    }
    // An enum value is one of a fixed set of strings, and consumer code
    // compares against those strings. Weaving stega into it would break every
    // such comparison, so it is handed back verbatim — as a literal is.
    if (recOpts?.schema && isEnumSchema(recOpts?.schema)) {
      return sourceOrSelector;
    }
    if (recOpts?.schema && isDiscriminatedUnionSchema(recOpts?.schema)) {
      const variantSchema = resolveDiscriminatedUnionVariant(
        sourceOrSelector,
        recOpts.schema,
      );
      if (variantSchema) {
        return rec(sourceOrSelector, {
          path: recOpts.path,
          schema: variantSchema,
        });
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
        // The modules this module's views point at. Collected HERE because this
        // is the only place with the schema INSTANCE — everything below walks
        // the serialized schema, which carries a path and not a module. Merged
        // rather than replaced: a handle resolved by `useVal` re-enters here as
        // its own module, and its parent's views must stay resolvable.
        for (const [path, valModule] of Internal.viewModulesOf(newSchema)) {
          viewModules.set(path, valModule);
        }
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

function isLocaleSchema(
  schema: SerializedSchema | undefined,
): schema is SerializedLocaleSchema {
  return schema?.type === "locale";
}

function isCodeSchema(
  schema: SerializedSchema | undefined,
): schema is SerializedCodeSchema {
  return schema?.type === "code";
}

function unknownSchema(schema: unknown) {
  console.debug("Found unknown schema", schema);
  return schema;
}

function isDiscriminatedUnionSchema(
  schema: SerializedSchema | undefined,
): schema is SerializedDiscriminatedUnionSchema {
  return schema?.type === "discriminated-union";
}

function isEnumSchema(
  schema: SerializedSchema | undefined,
): schema is SerializedEnumSchema {
  return schema?.type === "enum";
}

function isKeyOfSchema(
  schema: SerializedSchema | undefined,
): schema is SerializedKeyOfSchema {
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
  } else if (schema.type === "discriminated-union") {
    for (const item of schema.items) {
      collectReferencedModulesFromSchema(item, acc);
    }
  }
}

export function stegaClean(source: string) {
  return vercelStegaSplit(source).cleaned;
}

/**
 * Answers already computed, keyed by the selector they were computed from.
 *
 * `getModuleIds` is not cheap: it calls `executeSerialize()`, which rebuilds the
 * whole serialized schema tree on every call — ~31us for a 40-field schema with
 * a nested array, against ~4us for a small one. It is called from `useValStega`
 * on every render whose `useMemo` misses.
 *
 * That memo misses on every render for a VIEW, and cannot be fixed there: the
 * handle is built by `createViewHandle` inside `stegaEncode`, so `page.authors`
 * is a fresh object each time the page is encoded, and `[selector]` is a new
 * dependency every render. Caching here rather than in the hooks fixes it for
 * both copies of the hook at once, and for any other caller.
 *
 * Keyed on the selector, which is the module itself for the case that matters —
 * a view resolves to it on the line below, and a module is a module-level
 * constant, so the entry is hit for the life of the process. A fresh nested
 * selector misses, as it did before; a `WeakMap` lets those entries go.
 *
 * The array is shared, so it is frozen: nothing may sort or splice it in place.
 * Every consumer today copies first (`createSubscriberId` does `paths.slice()`),
 * and freezing is what keeps that true.
 */
const moduleIdsCache = new WeakMap<object, string[]>();

export function getModuleIds(input: any): string[] {
  // A view handle names one module: the one it points at. Resolved first so a
  // `useVal(page.header)` subscribes to the header rather than to nothing — and
  // so the recursive call lands on the module, which is what the cache above
  // can actually key on.
  const resolved = Internal.viewHandleModule(input);
  if (resolved !== undefined) {
    return getModuleIds(resolved);
  }
  const cacheable = typeof input === "object" && input !== null;
  if (cacheable) {
    const cached = moduleIdsCache.get(input);
    if (cached) {
      // Frozen, so handing the same array to every caller is safe.
      return cached;
    }
  }
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
  const moduleIds = Array.from(modules);
  // Frozen before it is shared, not after: a consumer that sorts in place would
  // otherwise corrupt every later caller's answer, and silently.
  Object.freeze(moduleIds);
  if (cacheable) {
    moduleIdsCache.set(input, moduleIds);
  }
  return moduleIds;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function isDate(s: string) {
  return Boolean(Date.parse(s));
}
