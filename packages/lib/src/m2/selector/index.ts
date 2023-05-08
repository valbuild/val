/* eslint-disable @typescript-eslint/no-unused-vars */
import { I18nSelector } from "./i18n";
import { Selector as ObjectSelector } from "./object";
import { UndistributedSourceArray as ArraySelector } from "./array";
import { Selector as NumberSelector } from "./number";
import { Selector as StringSelector } from "./string";
import { Selector as BooleanSelector } from "./boolean";
import { Selector as UndefinedSelector } from "./undefined";
import { AssetSelector } from "./asset";
import { Val } from "../val";
import {
  FileSource,
  I18nSource,
  RemoteSource,
  Source,
  SourceArray,
  SourceObject,
  SourcePrimitive,
} from "../Source";
import { Schema } from "../schema";
import { Expr } from "../expr/expr";
import { RemoteSelector } from "./remote";

/**
 * Selectors can be used to select parts of a Val module.
 * Unlike queries, joins, aggregates etc is and will not be supported.
 *
 * They are designed to be be used as if they were "normal" JSON data.
 *
 * Selectors works equally on source content, defined in code, and remote content.
 *
 * @example
 * // Select the title of a document
 * const titles = useVal(docsVal.map((doc) => doc.title));
 *
 * @example
 * // Match on a union type
 * const titles = useVal(docsVal.map((doc) => doc.match("type", {
 *   newsletter: (newsletter) => newsletter.title,
 *   email: (email) => email.subject,
 * }));
 *
 */
export type Selector<T extends Source> = Source extends T
  ? SelectorC<T>
  : T extends I18nSource<string, infer S>
  ? I18nSelector<S>
  : T extends RemoteSource<infer S>
  ? S extends
      | SourcePrimitive
      | SourceObject
      | SourceArray
      | FileSource<string>
      | I18nSource<
          string,
          SourcePrimitive | SourceObject | SourceArray | FileSource<string>
        >
    ? RemoteSelector<S>
    : never
  : T extends FileSource<string>
  ? AssetSelector
  : T extends SourceObject
  ? ObjectSelector<T>
  : T extends SourceArray
  ? ArraySelector<T>
  : T extends string
  ? StringSelector<T>
  : T extends number
  ? NumberSelector<T>
  : T extends boolean
  ? BooleanSelector<T>
  : T extends undefined
  ? UndefinedSelector<T>
  : never;

export type SelectorSource =
  | {
      [key: string]: SelectorSource;
    }
  | SelectorSource[]
  | SourcePrimitive
  | I18nSource<
      string,
      SourcePrimitive | SourceObject | SourceArray | FileSource<string>
    >
  | RemoteSource<
      | SourcePrimitive
      | SourceObject
      | SourceArray
      | FileSource<string>
      | I18nSource<
          string,
          SourcePrimitive | SourceObject | SourceArray | FileSource<string>
        >
    >
  | FileSource<string>
  | SelectorC<Source>;

/**
 * @internal
 */
export const VAL_OR_EXPR = Symbol("getValOrExpr");
/**
 * @internal
 */
export const SCHEMA = Symbol("getSchema");

export abstract class SelectorC<out T extends Source> {
  /**
   * @internal
   */
  constructor(
    protected valOrExpr: any,
    // TODO: this is the actual type, but it is hard to use in the implementations - this is internal so any is ok?
    // | Val<Source> /* Val<T> makes the type-checker confused, we do not really know why */
    // | Expr,
    protected readonly __fakeField?: T /* do not use this, we must have it to make type-checking (since classes are compared structurally?)  */
  ) {}

  assert<U extends Source, E extends Source = undefined>(
    schema: Schema<U>,
    other?: () => E
  ): SelectorOf<U | E> {
    throw new Error("Not implemented");
  }

  abstract [VAL_OR_EXPR](): { val: T; valPath: string } | Expr;
}

export interface AsVal<T extends Source> {
  /**
   * @internal
   */
  [VAL_OR_EXPR](): Val<T> | Expr;
}

type SourceOf<T extends SelectorSource> = T extends SelectorC<infer S>
  ? S
  : T extends (infer S)[]
  ? S extends SelectorSource
    ? SourceOf<S>[]
    : never
  : T extends { [key: string]: SelectorSource }
  ? {
      [key in keyof T]: T[key] extends SelectorSource
        ? SourceOf<T[key]>
        : never;
    }
  : T extends Source
  ? T
  : never;

/**
 * Use this type to convert types that accepts both Source and Selectors
 *
 * An example would be where literals are supported like in most higher order functions (e.g. map in array)
 **/
export type SelectorOf<U extends SelectorSource> =
  // TODO: investigate why Selector<SourceOf<U>> does not work in all cases
  SourceOf<U> extends infer S
    ? S extends Source
      ? Selector<S>
      : never
    : never;
