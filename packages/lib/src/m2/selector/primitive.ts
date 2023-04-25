import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
  SourcePrimitive,
} from ".";

declare const brand: unique symbol;
export type Selector<T extends SourcePrimitive> = SelectorC<T> & {
  eq(other: SourcePrimitive): Selector<boolean>;
  readonly [brand]: "PrimitiveSelector";
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): SelectorOf<U>;
};
