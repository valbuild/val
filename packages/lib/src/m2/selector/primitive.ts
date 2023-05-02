import {
  AsVal,
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
  VAL,
} from ".";
import { SourcePrimitive } from "../Source";
import { Val } from "../val";

/**
 * TODO: improve docs
 *
 * @example
 * const isEquals: Val<boolean> = useVal(titleVal.eq("something"));
 *
 */
export type Selector<T extends SourcePrimitive> = PrimitiveSelector<T>;

class PrimitiveSelector<T extends SourcePrimitive>
  extends SelectorC<T>
  implements AsVal<T>
{
  eq(other: SourcePrimitive): Selector<boolean> {
    throw Error("TODO: implement me");
  }
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): SelectorOf<U> {
    throw Error("TODO: implement me");
  }
  [VAL](): Val<T> {
    throw Error("TODO: implement me");
  }
}
