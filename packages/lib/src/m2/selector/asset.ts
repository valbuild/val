import {
  Selector as UnknownSelector,
  GenericSelector,
  SelectorOf,
  SelectorSource,
} from ".";
import { F } from "ts-toolbelt";

// TODO: docs
export type AssetSelector = GenericSelector<{ url: string }> & {
  readonly url: UnknownSelector<string>;
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<{ url: string }>>) => U
  ): SelectorOf<U> | UnknownSelector<boolean>;
};
