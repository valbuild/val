import { Selector as UnknownSelector } from ".";

declare const brand: unique symbol;

export type AssetSelector = {
  url: UnknownSelector<string>;
  [brand]: "AssetSelector";
};
