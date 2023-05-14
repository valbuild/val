import { Json } from "../Json";
import { Selector as PrimitiveSelector } from "./PrimitiveSelector";
import {
  GenericSelectorArray,
  GenericSelector,
  JsonOfSelector,
  Selector as UnknownSelector,
  SelectorSource,
} from "./Selector";

export type Selector<S extends GenericSelectorArray> = GenericSelector<
  JsonOfSelector<S>
> & {
  readonly [key in keyof S & number]: S[key];
} & {
  readonly length: PrimitiveSelector<number>;
  filter(
    predicate: (
      v: UnknownSelector<S[number]>
    ) => UnknownSelector<Json | undefined> | Json | undefined
  ): Selector<S>;
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<S>>) => U
  ): UnknownSelector<U> | Selector<NonNullable<S>>;
};
