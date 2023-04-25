import { Source } from "../../Source";
import { Selector as UnknownSelector, SelectorOf, SelectorSource } from ".";

declare const brand: unique symbol;

export type I18n<T extends Source> = T & {
  readonly [brand]: "I18nDescriptor";
};

export type I18nSelector<T extends Source> = UnknownSelector<T> & {
  readonly [brand]: "I18nSelector";

  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => SelectorOf<U>
  ): SelectorOf<U>;
};
