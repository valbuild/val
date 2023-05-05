import {
  AsVal,
  Selector as UnknownSelector,
  SelectorC,
  SelectorOf,
  SelectorSource,
  VAL_OR_EXPR as VAL,
  VAL_OR_EXPR,
} from ".";
import { Val } from "../val";
import { BooleanSelector } from "./boolean";
import * as expr from "../expr/expr";
import { createSelector } from "./create";
import { newExprSelectorProxy } from "./expr";

/**
 * TODO: improve docs
 *
 * @example
 * const isEquals: Val<boolean> = useVal(titleVal.eq("something"));
 *
 */
export type Selector<T extends string> = StringSelector<T>;

/**
 * @internal
 */
export class StringSelector<T extends string>
  extends SelectorC<T>
  implements AsVal<T>
{
  constructor(valOrExpr: expr.Expr | Val<T>) {
    super(valOrExpr);
  }
  [VAL_OR_EXPR](): expr.Expr | Val<T> {
    return this.valOrExpr;
  }

  eq(other: string): BooleanSelector<boolean> {
    const valOrExpr = this.valOrExpr as Val<T>;
    if (valOrExpr instanceof expr.Expr) {
      return newExprSelectorProxy<string>(valOrExpr).eq(other);
    }
    return createSelector(valOrExpr.val === other);
  }

  andThen<U extends SelectorSource>(
    f: (v: UnknownSelector<T>) => U
  ): SelectorOf<U> {
    if (this.valOrExpr instanceof expr.Expr) {
      return newExprSelectorProxy<string>(this.valOrExpr).andThen(f);
    }

    if (this.valOrExpr.val) {
      const res = f(this as UnknownSelector<T>);
      if (res instanceof SelectorC) {
        return res as SelectorOf<U>;
      }
      return createSelector(res) as SelectorOf<U>;
    }
    return this as SelectorOf<U>;
  }
}
