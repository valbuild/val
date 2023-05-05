import {
  AsVal,
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
  VAL_OR_EXPR,
} from ".";
import { Val } from "../val";

/**
 * TODO: improve docs
 *
 * @example
 * const isEquals: Val<boolean> = useVal(titleVal.eq(1));
 *
 */
export type Selector<T extends number> = NumberSelector<T>;

class NumberSelector<T extends number>
  extends SelectorC<T>
  implements AsVal<T>
{
  eq(other: number): UnknownSelector<boolean> {
    throw Error("TODO: implement me");
  }
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): SelectorOf<U> {
    throw Error("TODO: implement me");
  }
  [VAL_OR_EXPR](): Val<T> {
    throw Error("TODO: implement me");
  }
}
