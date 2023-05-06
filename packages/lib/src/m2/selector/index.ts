/* eslint-disable @typescript-eslint/no-unused-vars */
import { I18nSelector } from "./i18n";
import { UndistributedSourceObject as ObjectSelector } from "./object";
import { UndistributedSourceArray as ArraySelector } from "./array";
import { Selector as NumberSelector } from "./number";
import { Selector as StringSelector } from "./string";
import { Selector as BooleanSelector } from "./boolean";
import { OptionalSelector as OptionalSelector } from "./optional";
import { AssetSelector } from "./asset";
import { SourcePath, Val } from "../val";
import {
  FileSource,
  I18nSource,
  RemoteRef,
  RemoteSource,
  Source,
  SourceArray,
  SourceObject,
  SourcePrimitive,
} from "../Source";
import { Val as ObjectVal } from "../val/object";
import { Val as ArrayVal } from "../val/array";
import { Val as PrimitiveVal } from "../val/primitive";
import { Schema } from "../schema";
import { Expr } from "../expr/expr";

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
export type Selector<T extends Source> = // NOTE: the "un-distribution of the conditional type is important for selectors:
  // https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types
  // NOTE: working with selectors might give you: "Type instantiation is excessively deep and possibly infinite." errors.
  // Have a look here for tips to helping solve it: https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
  Source extends T
    ? SelectorC<T>
    : [T] extends [I18nSource<string, infer S> | undefined]
    ? I18nSelector<NonNullable<S>> | OptionalSelector<T>
    : [T] extends [RemoteSource<infer S> | undefined]
    ? Selector<NonNullable<S>> | OptionalSelector<T>
    : [T] extends [FileSource<string> | undefined]
    ? AssetSelector | OptionalSelector<T>
    : [T] extends [SourceObject | undefined]
    ? ObjectSelector<NonNullable<T>> | OptionalSelector<T>
    : [T] extends [SourceArray | undefined]
    ? ArraySelector<NonNullable<T>> | OptionalSelector<T>
    : [T] extends [string | undefined]
    ? StringSelector<NonNullable<T>> | OptionalSelector<T>
    : [T] extends [number | undefined]
    ? NumberSelector<NonNullable<T>> | OptionalSelector<T>
    : [T] extends [boolean | undefined]
    ? BooleanSelector<NonNullable<T>> | OptionalSelector<T>
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
export type SelectorOf<U extends SelectorSource> = [SourceOf<U>] extends [
  infer S extends Source
]
  ? Selector<S>
  : never;
