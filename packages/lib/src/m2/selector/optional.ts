import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
} from ".";
import { Source, SourcePrimitive } from "../Source";

export type OptionalSelector<T> = T extends undefined ? Selector<T> : never;

// TODO: docs
type Selector<T extends Source> = SelectorC<T> & {
  eq(other: Source): UnknownSelector<boolean>;
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): SelectorOf<U> | Selector<T>;
};
