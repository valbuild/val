import {
  AsVal,
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
  VAL_OR_EXPR,
} from ".";
import { Val } from "../val";
import * as expr from "../expr/expr";

/**
 * TODO: improve docs
 *
 * @example
 * const isEquals: Val<boolean> = useVal(titleVal.eq(true));
 *
 */
export type Selector<T extends boolean> = BooleanSelector<T>;

export class BooleanSelector<T extends boolean>
  extends SelectorC<T>
  implements AsVal<T>
{
  constructor(valOrExpr: Val<boolean> | expr.Expr) {
    super(valOrExpr);
  }
  [VAL_OR_EXPR](): expr.Expr | Val<T> {
    return this.valOrExpr;
  }

  eq(other: boolean): any {
    throw Error("TODO: implement me");
  }
  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<NonNullable<T>>) => U
  ): SelectorOf<U> {
    throw Error("TODO: implement me");
  }
}
