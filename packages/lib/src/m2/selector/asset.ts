import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
} from ".";

declare const brand: unique symbol;

export type AssetSelector = SelectorC<{ url: string }> & {
  readonly url: UnknownSelector<string>;
  readonly [brand]: "AssetSelector";

  andThen<U extends SelectorSource>(f: (v: AssetSelector) => U): SelectorOf<U>;
};
