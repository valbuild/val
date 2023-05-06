import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
} from ".";

// TODO: docs
export type AssetSelector = SelectorC<{ url: string }> & {
  readonly url: UnknownSelector<string>;
  andThen<U extends SelectorSource>(
    f: (v: AssetSelector) => U
  ): SelectorOf<U> | AssetSelector;
};
