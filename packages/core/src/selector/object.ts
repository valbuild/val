import {
  Selector as UnknownSelector,
  GenericSelector,
  SelectorOf,
  SelectorSource,
} from ".";
import { SourceObject } from "../source";

// TODO: docs
export type Selector<T extends SourceObject> = GenericSelector<T> & {
  fold<Tag extends string>(
    key: Tag
  ): <U extends SelectorSource>(cases: {
    [key in T[Tag & keyof T] & string]: (v: UnknownSelector<T>) => U;
  }) => SelectorOf<U>;

  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): SelectorOf<U>;
} & {
  readonly [key in keyof T]: UnknownSelector<T[key]>;
};
