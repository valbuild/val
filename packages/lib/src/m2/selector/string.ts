import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
} from ".";
import { Source } from "../Source";

// TODO: docs
export type Selector<T extends string> = SelectorC<T> & {
  eq(other: Source): UnknownSelector<boolean>;
  andThen<U extends SelectorSource>(
    f: (v: Selector<string>) => U
  ): SelectorOf<U> | Selector<string>;
};
