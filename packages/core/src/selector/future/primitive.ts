import {
  Selector as UnknownSelector,
  GenericSelector,
  SelectorOf,
  SelectorSource,
} from ".";
import { Source, SourcePrimitive } from "../../source";
import { Selector as BooleanSelector } from "./boolean";

export type Selector<T extends SourcePrimitive> = GenericSelector<T> & {
  eq(other: Source): BooleanSelector<boolean>;
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): SelectorOf<U | NullableOf<T>>;
};

type NullableOf<T extends Source> = T extends null ? null : never;
