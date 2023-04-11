import { NumberDescriptor } from "../descriptor";
import * as expr from "../expr";
import { PrimitiveSelector } from "./primitive";

export class NumberSelector<Ctx> extends PrimitiveSelector<
  NumberDescriptor,
  Ctx
> {
  constructor(expr: expr.Expr<Ctx, number>) {
    super(expr, NumberDescriptor);
  }
}

export function newNumberSelector<Ctx>(
  expr: expr.Expr<Ctx, number>
): NumberSelector<Ctx> {
  return new NumberSelector(expr);
}
