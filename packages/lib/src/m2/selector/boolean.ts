import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
} from ".";

// TODO: docs
export type Selector<T extends boolean> = SelectorC<T> & {
  eq(other: boolean): Selector<boolean>;
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): SelectorOf<U> | Selector<boolean>;
};
