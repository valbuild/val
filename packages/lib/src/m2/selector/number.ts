import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
} from ".";
import { Source } from "../Source";

// TODO:
export type Selector<T extends number> = SelectorC<T> & {
  eq(other: Source): UnknownSelector<boolean>;
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): SelectorOf<U> | Selector<T>;
};
