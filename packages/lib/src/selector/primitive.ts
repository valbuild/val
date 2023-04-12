import { PrimitiveDescriptor, ValueOf } from "../descriptor";
import * as expr from "../expr";
import { SourcePrimitive } from "../Source";
import { Selector, DESC, EXPR } from "./selector";

export class PrimitiveSelector<
  D extends PrimitiveDescriptor<SourcePrimitive>,
  Ctx
> extends Selector<D, Ctx> {
  constructor(
    protected readonly expr: expr.Expr<Ctx, ValueOf<D>>,
    private readonly desc: D
  ) {
    super();
  }

  [EXPR](): expr.Expr<Ctx, ValueOf<D>> {
    return this.expr;
  }
  [DESC](): D {
    return this.desc;
  }
}

export function newPrimitiveSelector<
  D extends PrimitiveDescriptor<SourcePrimitive>,
  Ctx
>(expr: expr.Expr<Ctx, ValueOf<D>>, desc: D): PrimitiveSelector<D, Ctx> {
  return new PrimitiveSelector(expr, desc);
}
