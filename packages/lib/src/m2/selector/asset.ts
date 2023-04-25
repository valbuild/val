import { Selector as UnknownSelector, SelectorOf, SelectorSource } from ".";

declare const brand: unique symbol;

export type AssetSelector = {
  readonly url: UnknownSelector<string>;
  readonly [brand]: "AssetSelector";

  andThen<U extends SelectorSource>(f: (v: AssetSelector) => U): SelectorOf<U>;
};
