import {
  FileSource,
  SourceTuple,
  SourceObject,
  SourcePrimitive,
} from "../Source";
import { Selector as UnknownSelector } from ".";

declare const brand: unique symbol;

export type I18nSelector<
  T extends SourcePrimitive | SourceObject | SourceTuple | FileSource<string>
> = UnknownSelector<T> & {
  readonly [brand]: "I18nSelector";
};
