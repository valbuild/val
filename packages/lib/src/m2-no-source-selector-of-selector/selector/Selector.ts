import { Json, JsonArray, JsonObject, JsonPrimitive } from "../Json";
import {
  FileSource,
  I18nCompatibleSource,
  I18nSource,
  RemoteSource,
  Source,
  SourceArray,
  SourceObject,
  SourcePrimitive,
} from "../Source";
import { Path, PathSegments, Val } from "../val";
import { Selector as ArraySelector } from "./ArraySelector";
import { Selector as FileSelector } from "./FileSelector";
import { Selector as I18nSelector } from "./I18nSelector";
import { Selector as ObjectSelector } from "./ObjectSelector";
import { Selector as PrimitiveSelector } from "./PrimitiveSelector";
import {
  Selector as RemoteSelector,
  RemoteCompatibleSelectors,
} from "./RemoteSelector";

type BaseSelectors =
  | PrimitiveSelector<JsonPrimitive>
  | ObjectSelector<GenericSelectorObject>
  | ArraySelector<GenericSelectorArray>;

type ExtensionSelectors =
  | FileSelector
  | I18nSelector<readonly string[], BaseSelectors | FileSelector>
  | RemoteSelector<RemoteCompatibleSelectors>;

export type GenericSelectorObject = {
  [key: string]: any; // TODO: GenericSelector<Json>
};
export type GenericSelectorArray = readonly any[]; // TODO: readonly GenericSelector<Json>[]

export type Selectors =
  | PrimitiveSelector<JsonPrimitive>
  | ObjectSelector<GenericSelectorObject>
  | ArraySelector<GenericSelectorArray>
  | ExtensionSelectors;

export const ValOrExpr = Symbol("ValOrExpr");
export const ValError = Symbol("ValError");
export class GenericSelector<
  out T extends Json,
  Error extends string | undefined = undefined
> {
  readonly [Path]: PathSegments | undefined;
  readonly [ValOrExpr]: T; // or Expr
  readonly [ValError]: Error | undefined;
  constructor(valOrExpr: T, path: PathSegments | undefined, error?: Error) {
    this[Path] = path;
    this[ValOrExpr] = valOrExpr;
    this[ValError] = error;
  }
}

/// Extensions
export const SelectorExtensionBrand = Symbol("SelectorExtension");

///

export type SelectorSource =
  | SourcePrimitive
  | undefined
  | I18nSource<readonly string[], I18nCompatibleSource>
  | RemoteSource<Json>
  | FileSource<string>
  | { readonly [key in string]: SelectorSource }
  | readonly SelectorSource[]
  | SelectorSource[]
  | Selectors;

type SelectorOfI18nSource<S extends I18nCompatibleSource> =
  S extends SourcePrimitive ? PrimitiveSelector<S> : never;

type GenericSelectorObjectOfSourceObject<S extends SourceObject> = {
  [key in keyof S]: S[key] extends Source ? SelectorOfSource<S[key]> : never;
};

type SelectorOfSource<S extends Source> = Source extends S
  ? GenericSelector<Json>
  : S extends SourcePrimitive
  ? PrimitiveSelector<S>
  : S extends I18nSource<readonly string[], infer LocalizedSource>
  ? LocalizedSource extends I18nCompatibleSource
    ? I18nSelector<string[], SelectorOfI18nSource<LocalizedSource>>
    : never
  : S extends RemoteSource<infer RS>
  ? SelectorOfSource<RS> extends RemoteCompatibleSelectors
    ? RemoteSelector<SelectorOfSource<RS>>
    : GenericSelector<
        Json,
        "Could not create remote selector of source. Only types that extends Json can be remote."
      >
  : //
  S extends FileSource<string>
  ? FileSelector
  : S extends SourceArray
  ? ArraySelector<readonly SelectorOfSource<S[number]>[]>
  : S extends SourceObject
  ? ObjectSelector<GenericSelectorObjectOfSourceObject<S>>
  : GenericSelector<Json, "Could not create selector of source">;

export type Selector<S extends SelectorSource> = Source extends S
  ? GenericSelector<Json>
  : S extends undefined
  ? Selector<null>
  : S extends Source
  ? SelectorOfSource<S>
  : S extends Selectors
  ? S
  : S extends { readonly [key in string]: SelectorSource }
  ? ObjectSelector<{
      [key in keyof S]: Selector<S[key]>;
    }>
  : S extends readonly SelectorSource[]
  ? ArraySelector<readonly Selector<S[number]>[]>
  : GenericSelector<Json, "Could not create selector">;

/// Helpers

export type JsonOfSelector<
  S extends GenericSelector<Json> | GenericSelectorObject | GenericSelectorArray
> = S extends { [key in string]: GenericSelector<Json> }
  ? {
      [key in keyof S]: S[key] extends GenericSelector<infer Json>
        ? Json
        : never;
    }
  : S extends readonly GenericSelector<infer Json>[]
  ? Json
  : never;
