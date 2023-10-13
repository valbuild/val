import { Selector as ObjectSelector } from "./object";
import { UndistributedSourceArray as ArraySelector } from "./array";
import { Selector as NumberSelector } from "./number";
import { Selector as StringSelector } from "./string";
import { Selector as BooleanSelector } from "./boolean";
import { Selector as PrimitiveSelector } from "./primitive";
import { FileSelector } from "./file";
import { SourcePath } from "../val";
import { Source, SourceArray, SourceObject, SourcePrimitive } from "../source";
import { Schema } from "../schema";
import type { A } from "ts-toolbelt";
import { FileSource } from "../source/file";
import { RichText, RichTextOptions, RichTextSource } from "../source/richtext";

export type Selector<T extends Source> = Source extends T
  ? GenericSelector<T>
  : T extends FileSource
  ? FileSelector
  : T extends RichTextSource<infer O>
  ? RichText<O>
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
  | FileSource
  | RichTextSource<RichTextOptions>
  | GenericSelector<Source>;

/**
 * @internal
 */
export const GetSchema = Symbol("GetSchema");
/**
/**
 * @internal
 */
export const Path = Symbol("Path");
/**
 * @internal
 */
export const GetSource = Symbol("GetSource");
/**
 * @internal
 */
export const ValError = Symbol("ValError");
export abstract class GenericSelector<
  out T extends Source,
  Error extends string | undefined = undefined
> {
  readonly [Path]: SourcePath | undefined;
  readonly [GetSource]: T;
  readonly [ValError]: Error | undefined;
  readonly [GetSchema]: Schema<T> | undefined;
  constructor(
    valOrExpr: T,
    path: SourcePath | undefined,
    schema?: Schema<T>,
    error?: Error
  ) {
    this[Path] = path;
    this[GetSource] = valOrExpr;
    this[ValError] = error;
    this[GetSchema] = schema;
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

export function getSchema(
  selector: Selector<Source>
): Schema<SelectorSource> | undefined {
  return selector[GetSchema];
}
