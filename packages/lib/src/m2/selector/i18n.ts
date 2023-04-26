import {
  FileSource,
  Source,
  SourceArray,
  SourceObject,
  SourcePrimitive,
} from "../selector";
import { Selector as UnknownSelector, SelectorOf, SelectorSource } from ".";

declare const brand: unique symbol;

export type I18n<
  Locales extends string,
  T extends SourcePrimitive | SourceObject | SourceArray | FileSource<string>
> = {
  readonly [locale in Locales]: T;
} & {
  readonly [brand]: "I18nDescriptor";
};

export type I18nSelector<
  T extends SourcePrimitive | SourceObject | SourceArray | FileSource<string>
> = UnknownSelector<T> & {
  readonly [brand]: "I18nSelector";

  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => SelectorOf<U>
  ): SelectorOf<U>;
};
