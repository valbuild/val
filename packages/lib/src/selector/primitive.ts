import * as expr from "../expr";
import { BaseSelector, EXPR, Selector } from "./selector";

export class PrimitiveSelector<Ctx, Out>
  extends BaseSelector<Ctx, Out>
  implements Selector<Ctx, Out>
{
  constructor(private readonly expr: expr.Expr<Ctx, Out>) {
    super();
  }

  [EXPR](): expr.Expr<Ctx, Out> {
    return this.expr;
  }
}

export function newPrimitiveSelector<Ctx, Out>(
  expr: expr.Expr<Ctx, Out>
): Selector<Ctx, Out> {
  return new PrimitiveSelector(expr);
}
