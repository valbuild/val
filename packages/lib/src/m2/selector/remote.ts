import {
  FileSource,
  I18nCompatibleSource,
  I18nSource,
  RemoteCompatibleSource,
  Source,
  SourceArray,
  SourceObject,
  SourcePrimitive,
} from "../Source";
import { Selector as UnknownSelector } from ".";

declare const brand: unique symbol;

export type RemoteSelector<T extends RemoteCompatibleSource> =
  UnknownSelector<T> & {
    readonly [brand]: "RemoteSelector";
  };
