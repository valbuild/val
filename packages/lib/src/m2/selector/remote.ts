import {
  FileSource,
  I18nSource,
  Source,
  SourceArray,
  SourceObject,
  SourcePrimitive,
} from "../Source";
import { Selector as UnknownSelector } from ".";

declare const brand: unique symbol;

export type RemoteSelector<
  T extends
    | SourcePrimitive
    | SourceObject
    | SourceArray
    | FileSource<string>
    | I18nSource<
        string,
        SourcePrimitive | SourceObject | SourceArray | FileSource<string>
      >
> = UnknownSelector<T> & {
  readonly [brand]: "RemoteSelector";
};
