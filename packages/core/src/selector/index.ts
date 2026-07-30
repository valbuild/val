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
import { AllRichTextOptions, RichTextSource } from "../source/richtext";
import { ImageSelector } from "./image";
import { RichTextSelector } from "./richtext";
import { ImageSource } from "../source/image";
import { RemoteSource } from "../source/remote";

export type Selector<T extends Source> = Source extends T
  ? GenericSelector<T>
  : T extends ImageSource
    ? ImageSelector
    : T extends FileSource<infer M>
      ? FileSelector<M>
      : T extends RichTextSource<infer O>
        ? RichTextSelector<O>
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
  | ImageSource
  | FileSource
  | RemoteSource
  | RichTextSource<AllRichTextOptions>
  | GenericSelector<Source>;

// Identity symbols are registered in the global Symbol registry so that
// multiple bundled copies of @valbuild/core (e.g. the editor SPA bundle vs.
// the host Next.js bundle) resolve to the same Symbol instance. Without
// this, a value produced by one copy reads as `undefined` when accessed
// via these keys from the other copy — extractValModules running in the
// SPA against `.val.ts` modules loaded from the host bundle was hitting
// this exact failure mode.
/**
 * @internal
 */
export const GetSchema = Symbol.for("@valbuild/core/GetSchema");
/**
 * @internal
 */
export const Path = Symbol.for("@valbuild/core/Path");
/**
 * @internal
 */
export const GetSource = Symbol.for("@valbuild/core/GetSource");
/**
 * @internal
 */
export const ValError = Symbol.for("@valbuild/core/ValError");
export abstract class GenericSelector<
  out T extends Source,
  Error extends string | undefined = undefined,
> {
  readonly [Path]: SourcePath | undefined;
  readonly [GetSource]: T;
  readonly [ValError]: Error | undefined;
  readonly [GetSchema]: Schema<T> | undefined;
  constructor(
    valOrExpr: T,
    path: SourcePath | undefined,
    schema?: Schema<T>,
    error?: Error,
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
  selector: Selector<Source>,
): Schema<SelectorSource> | undefined {
  return selector[GetSchema];
}
