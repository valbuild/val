import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
  SourcePrimitive,
} from ".";

declare const brand: unique symbol;

export type OptionalSelector<T> = T extends undefined ? Selector<T> : never;

type Selector<T> = SelectorC<undefined> & {
  readonly [brand]: "OptionalSelector";
  eq: (other: SourcePrimitive) => UnknownSelector<boolean>;
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): [T] extends [never]
    ? Selector<undefined>
    : SelectorOf<U> | Selector<undefined>;
};
