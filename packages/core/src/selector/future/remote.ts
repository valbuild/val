import { Selector as UnknownSelector } from ".";
import { RemoteCompatibleSource } from "../../source/future/remote";

declare const brand: unique symbol;

export type RemoteSelector<T extends RemoteCompatibleSource> =
  UnknownSelector<T> & {
    readonly [brand]: "RemoteSelector";
  };
