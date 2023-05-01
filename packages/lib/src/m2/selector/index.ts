/* eslint-disable @typescript-eslint/no-unused-vars */
import { I18nSelector } from "./i18n";
import { UndistributedSourceObject as ObjectSelector } from "./object";
import { UndistributedSourceArray as ArraySelector } from "./array";
import { Selector as PrimitiveSelector } from "./primitive";
import { OptionalSelector as OptionalSelector } from "./optional";
import { AssetSelector } from "./asset";
import { expr } from "../..";
import {
  FileSource,
  I18nSource,
  RemoteSource,
  Source,
  SourceArray,
  SourceObject,
  SourcePrimitive,
} from "../Source";

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
export type Selector<T> = [T] extends [never] // stop recursion if never - improves type checking performance (though it has not been measured)
  ? never
  : // NOTE: the "un-distribution of the conditional type is important for selectors:
  // https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types
  // NOTE: working with selectors might give you: "Type instantiation is excessively deep and possibly infinite." errors.
  // Have a look here for tips to helping solve it: https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437

  [T] extends [I18nSource<string, infer S> | undefined]
  ? I18nSelector<NonNullable<S>> | OptionalSelector<T>
  : [T] extends [FileSource<string> | undefined]
  ? AssetSelector | OptionalSelector<T>
  : [T] extends [SourceObject | undefined]
  ? ObjectSelector<NonNullable<T>> | OptionalSelector<T>
  : [T] extends [SourceArray | undefined]
  ? ArraySelector<NonNullable<T>> | OptionalSelector<T>
  : [T] extends [string | boolean | number | undefined]
  ? PrimitiveSelector<NonNullable<T>> | OptionalSelector<T>
  : never;

export type SelectorSource =
  | {
      [key: string]: SelectorSource;
    }
  | SelectorSource[]
  | SourcePrimitive
  | I18nSource<
      string,
      | SourcePrimitive
      | SourceObject
      | SourceArray
      | FileSource<string>
      | RemoteSource<Source>
    >
  | RemoteSource<string>
  | FileSource<string>
  | SelectorC<SelectorSource>;

/**
 * @internal
 */
export const EXPR = Symbol("expr");
export abstract class SelectorC<out T> {
  /**
   * @internal
   */
  abstract [EXPR](): expr.Expr<[], T>;
}

export type SourceOf<T> = [T] extends [SelectorC<infer S>]
  ? S
  : [T] extends [unknown[]]
  ? SourceOf<T[number]>[]
  : [T] extends [{ [key: string]: unknown }]
  ? {
      [key in keyof T]: SourceOf<T[key]>;
    }
  : T;

/**
 * Use this type to convert types that accepts both Source and Selectors
 *
 * An example would be where literals are supported like in most higher order functions (e.g. map in array)
 **/
export type SelectorOf<U extends SelectorSource> = Selector<SourceOf<U>>;
