import { Selector as UnknownSelector } from ".";
import { RemoteCompatibleSource } from "../source/remote";

declare const brand: unique symbol;

export type RemoteSelector<T extends RemoteCompatibleSource> =
  UnknownSelector<T> & {
    readonly [brand]: "RemoteSelector";
  };
