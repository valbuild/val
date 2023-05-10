import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
} from ".";
import { F } from "ts-toolbelt";

// TODO: docs
export type AssetSelector = SelectorC<{ url: string }> & {
  readonly url: UnknownSelector<string>;
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<{ url: string }>>) => F.Narrow<U>
  ): SelectorOf<U> | UnknownSelector<boolean>;
};
