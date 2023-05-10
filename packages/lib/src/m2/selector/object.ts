import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
} from ".";
import { F } from "ts-toolbelt";
import { SourceObject } from "../Source";

// TODO: docs
export type Selector<T extends SourceObject> = SelectorC<T> & {
  fold<Tag extends string>(
    key: Tag
  ): <U extends SelectorSource>(cases: {
    [key in T[Tag & keyof T] & string]: (v: UnknownSelector<T>) => U;
  }) => SelectorOf<U>;

  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => F.Narrow<U>
  ): SelectorOf<U>;
} & {
  readonly [key in keyof T]: UnknownSelector<T[key]>;
};
