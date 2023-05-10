import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
} from ".";
import { Source, SourcePrimitive } from "../Source";
import { Selector as BooleanSelector } from "./boolean";
import { F } from "ts-toolbelt";

export type PrimitiveSelector<T extends SourcePrimitive> = SelectorC<T> & {
  eq(other: Source): BooleanSelector<boolean>;
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): SelectorOf<U | NullableOf<T>>;
};

type NullableOf<T extends Source> = T extends undefined ? undefined : never;
