import {
  FileSource,
  I18nSource,
  Source,
  SourceTuple,
  SourceObject,
  SourcePrimitive,
} from "../Source";
import { Selector as UnknownSelector } from ".";

declare const brand: unique symbol;

export type RemoteSelector<
  T extends
    | SourcePrimitive
    | SourceObject
    | SourceTuple
    | FileSource<string>
    | I18nSource<
        string,
        SourcePrimitive | SourceObject | SourceTuple | FileSource<string>
      >
> = UnknownSelector<T> & {
  readonly [brand]: "RemoteSelector";
};
