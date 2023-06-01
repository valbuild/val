import { SourceArray, SourceObject, SourcePrimitive } from "../source";
import { Selector as UnknownSelector } from ".";
import { FileSource } from "../source/file";

declare const brand: unique symbol;

export type I18nSelector<
  Locales extends readonly string[],
  T extends SourcePrimitive | SourceObject | SourceArray | FileSource
> = UnknownSelector<T> & {
  readonly [brand]: "I18nSelector";
  all(): { [locale in Locales[number]]: UnknownSelector<T> };
};
