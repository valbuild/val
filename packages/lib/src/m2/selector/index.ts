/* eslint-disable @typescript-eslint/no-unused-vars */
import { I18nSelector } from "./i18n";
import { Selector as ObjectSelector } from "./object";
import { UndistributedSourceArray as ArraySelector } from "./array";
import { Selector as NumberSelector } from "./number";
import { Selector as StringSelector } from "./string";
import { Selector as BooleanSelector } from "./boolean";
import { PrimitiveSelector } from "./primitive";
import { AssetSelector } from "./asset";
import { SourcePath } from "../val";
import {
  FileSource,
  I18nCompatibleSource,
  I18nSource,
  RemoteCompatibleSource,
  RemoteSource,
  Source,
  SourceArray,
  SourceObject,
  SourcePrimitive,
} from "../Source";
import { Schema } from "../schema";
import { Expr } from "../expr/expr";
import { RemoteSelector } from "./remote";
import { A } from "ts-toolbelt";

/**
 * Selectors can be used to select parts of a Val module.
 * Unlike queries, joins, aggregates etc is and will not be supported.
 *
 * They are designed to be be used as if they were "normal" JSON data,
 * though some concessions must be made because of TypeScript limitations.
 *
 * Selectors works equally on source content, defined in code, and remote content.
 *
 * @example
 * // Select the title of a document
 * const titles = useVal(docsVal.map((doc) => doc.title));
 *
 * @example
 * // Match on a union type
 * const titles = useVal(docsVal.map((doc) => doc.fold("type")({
 *   newsletter: (newsletter) => newsletter.title,
 *   email: (email) => email.subject,
 * }));
 *
 */
export type Selector<T extends Source> = Source extends T
  ? GenericSelector<T>
  : T extends I18nSource<infer L, infer S>
  ? I18nSelector<L, S>
  : T extends RemoteSource<infer S>
  ? S extends RemoteCompatibleSource
    ? RemoteSelector<S>
    : GenericSelector<Source, "Could not determine remote source">
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
  : T extends null
  ? PrimitiveSelector<null>
  : never;

export type SelectorSource =
  | SourcePrimitive
  | undefined
  | readonly SelectorSource[]
  | {
      [key: string]: SelectorSource;
    }
  | I18nSource<readonly string[], I18nCompatibleSource>
  | RemoteSource<RemoteCompatibleSource>
  | FileSource<string>
  | GenericSelector<Source>;

/**
 * @internal
 */
export const Path = Symbol("Path");
/**
 * @internal
 */
export const SourceOrExpr = Symbol("SourceOrExpr");
/**
 * @internal
 */
export const ValError = Symbol("ValError");
export abstract class GenericSelector<
  out T extends Source,
  Error extends string | undefined = undefined
> {
  readonly [Path]: SourcePath | undefined;
  readonly [SourceOrExpr]: T | Expr;
  readonly [ValError]: Error | undefined;
  constructor(valOrExpr: T, path: SourcePath | undefined, error?: Error) {
    this[Path] = path;
    this[SourceOrExpr] = valOrExpr;
    this[ValError] = error;
  }

  assert<U extends Source, E extends Source = null>(
    schema: Schema<U>,
    other?: () => E
  ): SelectorOf<U | E> {
    throw new Error("Not implemented");
  }
}

export type SourceOf<T extends SelectorSource> = Source extends T
  ? Source
  : T extends Source
  ? T
  : T extends undefined
  ? null
  : T extends GenericSelector<infer S>
  ? S
  : T extends readonly (infer S)[] // NOTE: the infer S instead of Selector Source here, is to avoid infinite recursion
  ? S extends SelectorSource
    ? {
        [key in keyof T]: SourceOf<A.Try<T[key], SelectorSource>>;
      }
    : never
  : T extends { [key: string]: SelectorSource }
  ? {
      [key in keyof T]: SourceOf<A.Try<T[key], SelectorSource>>;
    }
  : never;

/**
 * Use this type to convert types that accepts both Source and Selectors
 *
 * An example would be where literals are supported like in most higher order functions (e.g. map in array)
 **/
export type SelectorOf<U extends SelectorSource> = Source extends U
  ? GenericSelector<Source>
  : SourceOf<U> extends infer S // we need this to avoid infinite recursion
  ? S extends Source
    ? Selector<S>
    : GenericSelector<Source, "Could not determine selector of source">
  : GenericSelector<Source, "Could not determine source">;
