import {
  FileSource,
  RemoteSource,
  Source,
  SourceArray,
  SourceObject,
  SourcePrimitive,
} from "../Source";
import { Selector as UnknownSelector, SelectorOf, SelectorSource } from ".";

declare const brand: unique symbol;

export type I18nSelector<
  T extends
    | SourcePrimitive
    | SourceObject
    | SourceArray
    | FileSource<string>
    | RemoteSource<Source> // TODO: this is not correct, but it simplifies the Selector type - consider removing this and checking that NonNullable<S> when "calling"  theI18nSelector in Selector type is not RemoveSource
> = UnknownSelector<T> & {
  readonly [brand]: "I18nSelector";

  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => SelectorOf<U>
  ): SelectorOf<U>;
};
