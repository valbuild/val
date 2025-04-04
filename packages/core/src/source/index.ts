import { FileSource } from "./file";
import { RemoteSource } from "./remote";
import { RichTextOptions, RichTextSource } from "./richtext";

export type Source =
  | SourcePrimitive
  | SourceObject
  | SourceArray
  | RemoteSource
  | FileSource
  | RichTextSource<RichTextOptions>;

export type SourceObject = { [key in string]: Source } & {
  // TODO: update these restricted parameters:
  /** Reserved name */
  fold?: never;
  /** Reserved name */
  assert?: never;
  /** Reserved name */
  andThen?: never;
  /** Reserved name */
  _ref?: never;
  /** Reserved name */
  _type?: never;
  /** Reserved name */
  val?: never;
  /** Reserved name */
  valPath?: never; // used when serializing vals
};
export type SourceArray = readonly Source[];
export type SourcePrimitive = string | number | boolean | null;

/* Branded extension types: file, remote, i18n  */
export const VAL_EXTENSION = "_type" as const;

export function getValExtension(source: Source) {
  return (
    source &&
    typeof source === "object" &&
    VAL_EXTENSION in source &&
    source[VAL_EXTENSION]
  );
}

/**
 * A phantom type parameter is one that doesn't show up at runtime, but is checked statically (and only) at compile time.
 *
 * An example where this is useful is remote types, where the type of the remote source is known at compile time,
 * but the value is not there before it is fetched.
 *
 * @example
 * type Example<T> = string & PhantomType<T>;
 *
 **/
declare const PhantomType: unique symbol;
export type PhantomType<T> = {
  [PhantomType]: T;
};
