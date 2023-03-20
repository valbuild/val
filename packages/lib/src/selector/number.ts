import * as expr from "../expr";
import { PrimitiveSelector } from "./primitive";
import { EXPR, Selector } from "./selector";

export interface NumberSelector<Ctx> extends Selector<Ctx, number> {
  sub(r: Selector<Ctx, number>): Selector<Ctx, number>;
}

class NumberSelectorC<Ctx>
  extends PrimitiveSelector<Ctx, number>
  implements NumberSelector<Ctx>
{
  sub(b: Selector<Ctx, number>): Selector<Ctx, number> {
    return newNumberSelector(expr.sub(this[EXPR](), b[EXPR]()));
  }
}

export function newNumberSelector<Ctx>(
  expr: expr.Expr<Ctx, number>
): NumberSelector<Ctx> {
  return new NumberSelectorC(expr);
}
