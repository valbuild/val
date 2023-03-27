import * as expr from "../expr";
import { PrimitiveSelector } from "./primitive";
import { Selector } from "./selector";

export type NumberSelector<Ctx> = Selector<Ctx, number>;

class NumberSelectorC<Ctx>
  extends PrimitiveSelector<Ctx, number>
  implements NumberSelector<Ctx> {}

export function newNumberSelector<Ctx>(
  expr: expr.Expr<Ctx, number>
): NumberSelector<Ctx> {
  return new NumberSelectorC(expr);
}
