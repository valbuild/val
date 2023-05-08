import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
} from ".";
import { Source, SourcePrimitive } from "../Source";

export type PrimitiveSelector<T extends SourcePrimitive> = SelectorC<T> & {
  eq(other: Source): UnknownSelector<boolean>;
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): SelectorOf<U> | UnknownSelector<boolean>;
};
