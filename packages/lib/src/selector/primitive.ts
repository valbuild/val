import { Descriptor, ValueOf } from "../descriptor";
import * as expr from "../expr";
import { BaseSelector, DESC, EXPR } from "./selector";

export class PrimitiveSelector<Ctx, D extends Descriptor> extends BaseSelector<
  Ctx,
  ValueOf<D>
> {
  constructor(
    protected readonly expr: expr.Expr<Ctx, ValueOf<D>>,
    private readonly desc: D
  ) {
    super();
  }

  [EXPR](): expr.Expr<Ctx, ValueOf<D>> {
    return this.expr;
  }
  [DESC](): Descriptor {
    return this.desc;
  }
}

export function newPrimitiveSelector<Ctx, D extends Descriptor>(
  expr: expr.Expr<Ctx, ValueOf<D>>,
  desc: D
): PrimitiveSelector<Ctx, D> {
  return new PrimitiveSelector(expr, desc);
}
