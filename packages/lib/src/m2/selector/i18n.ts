import { Source } from "../../Source";
import { Selector as UnknownSelector } from ".";

declare const brand: unique symbol;

export type I18nDescriptor<T extends Source> = T & {
  [brand]: "I18nDescriptor";
};

export type I18nSelector<T extends Source> = UnknownSelector<T> & {
  [brand]: "I18nSelector";
};
