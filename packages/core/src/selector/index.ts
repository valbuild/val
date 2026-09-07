import { Selector as ObjectSelector } from "./object";
import { UndistributedSourceArray as ArraySelector } from "./array";
import { Selector as NumberSelector } from "./number";
import { Selector as StringSelector } from "./string";
import { Selector as BooleanSelector } from "./boolean";
import { Selector as PrimitiveSelector } from "./primitive";
import { SourcePath } from "../val";
import { Source, SourceArray, SourceObject, SourcePrimitive } from "../source";
import { Schema } from "../schema";
import type { A } from "ts-toolbelt";
import { MediaSource } from "../source/media";
import { AllRichTextOptions, RichTextSource } from "../source/richtext";
import { RichTextSelector } from "./richtext";
import { JsonSource } from "../source/json";
import { ExternalRecordSrc } from "../source/external";
import { SettingsSource } from "../source/settings";

export type Selector<T extends Source> = Source extends T
  ? GenericSelector<T>
  : // Media is an ObjectSelector like any other object: `url` is generated at
    // resolve time, not reachable through a selector. The arm exists because
    // `SourceObject` cannot express optional properties, so media would
    // otherwise fall through to `never`.
    T extends MediaSource
    ? GenericSelector<T>
    : T extends JsonSource
      ? GenericSelector<JsonSource>
      : // An external record's entries are not reachable through a selector —
        // they are fetched by key. The arm exists so the marker does not fall
        // through to `SourceObject` and then to `never`, and it sits ABOVE
        // `SourceObject` for the same reason the settings arm sits below it:
        // the marker is structurally an object, so an arm any lower would never
        // be reached.
        //
        // `GenericSelector<T>`, NOT `GenericSelector<ExternalRecordSrc>`: the
        // marker's phantom parameters carry the item type, the label and the
        // readonly flag, and widening here throws all three away — which leaves
        // an adapter unable to be typed from the schema it is bound to.
        T extends ExternalRecordSrc
        ? GenericSelector<T>
        : T extends RichTextSource<infer O>
          ? RichTextSelector<O>
          : T extends SourceObject
            ? ObjectSelector<T>
            : T extends SourceArray
              ? ArraySelector<T>
              : // Settings, like media, is an object whose keys are OPTIONAL, so
                // it never matched `SourceObject` and fell through to `never`.
                //
                // The arm has to sit BELOW `SourceObject`: every object type that
                // does not conflict on `assistant` structurally satisfies
                // `SettingsSource`,
                // so an arm above would swallow ordinary objects. A
                // `GenericSelector` rather than an `ObjectSelector` because a
                // settings module is read by the Studio and the assistant, not
                // traversed with selectors.
                T extends SettingsSource
                ? GenericSelector<T>
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
  | MediaSource
  | JsonSource
  | ExternalRecordSrc
  | SettingsSource
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
