import {
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
} from ".";
import { SourcePrimitive } from "../Source";

declare const brand: unique symbol;

/**
 * TODO: improve docs
 *
 * @example
 * const isEquals: Val<boolean> = useVal(titleVal.eq("something"));
 *
 */
export type Selector<T extends SourcePrimitive> = SelectorC<T> & {
  eq(other: SourcePrimitive): Selector<boolean>;
  readonly [brand]: "PrimitiveSelector";
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): SelectorOf<U>;
};
