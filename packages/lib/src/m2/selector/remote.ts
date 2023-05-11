import { RemoteCompatibleSource } from "../Source";
import { Selector as UnknownSelector } from ".";

declare const brand: unique symbol;

export type RemoteSelector<T extends RemoteCompatibleSource> =
  UnknownSelector<T> & {
    readonly [brand]: "RemoteSelector";
  };
