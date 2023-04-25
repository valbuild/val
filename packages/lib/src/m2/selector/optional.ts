import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
  SourcePrimitive,
} from ".";

declare const brand: unique symbol;

export type OptionalSelector<T> = T extends undefined ? Selector<T> : never;

type Selector<T extends undefined> = SelectorC<undefined> & {
  readonly [brand]: "OptionalSelector";
  eq: (other: SourcePrimitive) => UnknownSelector<boolean>;
  andThen<V extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => V
  ): SelectorOf<V[]>;
};
