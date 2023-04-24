import { Selector as UnknownSelector } from ".";

declare const brand: unique symbol;

export type AssetSelector = {
  readonly url: UnknownSelector<string>;
  readonly [brand]: "AssetSelector";
};
