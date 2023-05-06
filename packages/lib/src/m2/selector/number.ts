import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
} from ".";

// TODO: docs
export type Selector<T extends number> = SelectorC<T> & {
  eq(other: number): UnknownSelector<boolean>;
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): SelectorOf<U> | Selector<T>;
};
