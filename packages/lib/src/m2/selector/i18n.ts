import {
  FileSource,
  SourceArray,
  SourceObject,
  SourcePrimitive,
} from "../Source";
import { Selector as UnknownSelector } from ".";

declare const brand: unique symbol;

export type I18nSelector<
  Locales extends readonly string[],
  T extends SourcePrimitive | SourceObject | SourceArray | FileSource<string>
> = UnknownSelector<T> & {
  readonly [brand]: "I18nSelector";
  all(): { [locale in Locales[number]]: UnknownSelector<T> };
};
