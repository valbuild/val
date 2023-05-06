import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
} from ".";

// TODO: docs
export type Selector<T extends string> = SelectorC<T> & {
  eq(other: string): UnknownSelector<boolean>;
  andThen<U extends SelectorSource>(
    f: (v: Selector<string>) => U
  ): SelectorOf<U> | Selector<string>;
};
