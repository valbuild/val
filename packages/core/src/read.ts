/**
 * What content READS as: the types a reader (`useVal`, `fetchVal`,
 * `useValRoute`) gives back for a Source.
 *
 * They are here, and not beside `stegaEncode` in `@valbuild/react` where they
 * were, because a schema has to be able to say them: `.component()` checks
 * the component it links against what the app will actually hand it, which is
 * the READ value (an image with its `url`, a string with its edit tag) and
 * not the Source. `@valbuild/react/stega` re-exports every one of them, so
 * nothing an app imports has moved.
 */
import type { Json, JsonPrimitive } from "./Json";
import type { RawString } from "./schema/string";
import type { GenericSelector, SelectorOf, SelectorSource } from "./selector";
import type { Source, SourceArray, SourceObject } from "./source";
import type { ValView } from "./selector/view";
import type {
  FileSource,
  ImageSource,
  IsVideoSource,
  MediaHotspot,
  VideoCaptionSource,
} from "./source/media";
import type { RichTextOptions, RichTextSource } from "./source/richtext";
import type { IsValComponentSource, ValComponent } from "./source/component";
import type { ValViewSource } from "./source/view";

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

/**
 * A video as a consumer sees it: what was authored, plus a generated `url` on
 * the video, on its poster and on each caption track.
 *
 * Only the video's own `url` carries the edit tag — a click on the player
 * reaches the field. The poster and the captions are parts of the same field,
 * not fields of their own, so their URLs are plain.
 *
 * An HLS stream (`mimeType` `application/vnd.apple.mpegurl`) plays natively in
 * Safari and needs a library such as hls.js everywhere else; `url` is then the
 * master playlist.
 */
export type Video = {
  readonly path: string;
  readonly url: ValEncodedString;
  readonly mimeType: string;
  readonly width?: number;
  readonly height?: number;
  readonly duration?: number;
  readonly alt?: string;
  readonly hotspot?: MediaHotspot;
  readonly posterTime?: number;
  readonly poster?: {
    readonly path: string;
    readonly url: string;
    readonly width?: number;
    readonly height?: number;
    readonly mimeType?: string;
  };
  readonly startTime?: number;
  readonly endTime?: number;
  readonly captions?: readonly (Omit<VideoCaptionSource, "patch_id"> & {
    readonly url: string;
  })[];
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
    : // Above `ImageSource`: a video is structurally an image too (a `path`
      // and optional fields), so this arm has to be asked first. Its declared
      // keys are what tell them apart (`IsVideoSource`): a field picked from a
      // set has no `mimeType` of its own, so a required one cannot. Not
      // distributive by itself, and need not be — the arm above already
      // split a union into its members.
      IsVideoSource<T> extends true
      ? Video
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
              ? // An object linked to a component (`.component()`) reads as
                // its fields AND as a `ValComponent`: the slot is optional on
                // the source, where it is only a mark, and required here,
                // where `ValComponentEditor` asks for it.
                IsValComponentSource<T> extends true
                ? {
                    [key in keyof T]: StegaOfSource<T[key]>;
                  } & ValComponent
                : {
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
 * What a reader gives back for a schema's source type `T`: `T` as a selector,
 * resolved. The same answer as `ResolvedVal` in `@valbuild/react/stega` for a
 * value that is not a view, which a schema's own source never is.
 */
export type ReadOf<T extends SelectorSource> =
  SelectorOf<T> extends GenericSelector<infer S> ? StegaOfSource<S> : never;
