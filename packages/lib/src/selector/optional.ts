import {
  descriptorOf,
  DescriptorOf,
  exprOf,
  getSelector,
  Selected,
  SelectorOf,
} from ".";
import {
  asRequired,
  AsRequired,
  DetailedOptionalDescriptor,
  NNDescriptor,
  ValueOf,
} from "../descriptor";
import * as expr from "../expr";
import { BaseSelector, DESC, EXPR } from "./selector";

export class OptionalSelector<Ctx, D extends NNDescriptor> extends BaseSelector<
  Ctx,
  ValueOf<D> | null
> {
  constructor(
    private readonly expr: expr.Expr<Ctx, ValueOf<D> | null>,
    private readonly item: D
  ) {
    super();
  }

  [EXPR]() {
    return this.expr;
  }
  [DESC](): DetailedOptionalDescriptor<D> {
    return {
      type: "optional",
      item: this.item,
    };
  }

  andThen<S extends Selected<readonly [ValueOf<D>]>>(
    callback: (v: SelectorOf<readonly [ValueOf<D>], D>) => S
  ): OptionalSelector<Ctx, AsRequired<DescriptorOf<S>>> {
    const vExpr = expr.fromCtx<readonly [ValueOf<D>], 0>(0);
    const selected = callback(getSelector(vExpr, this.item));
    return newOptionalSelector<Ctx, AsRequired<DescriptorOf<S>>>(
      expr.andThen(this.expr, exprOf(selected)) as expr.Expr<
        Ctx,
        ValueOf<AsRequired<DescriptorOf<S>>> | null
      >,
      asRequired(descriptorOf(selected))
    );
  }
}

export function newOptionalSelector<Ctx, D extends NNDescriptor>(
  expr: expr.Expr<Ctx, ValueOf<D> | null>,
  desc: D
): OptionalSelector<Ctx, D> {
  return new OptionalSelector(expr, desc);
}
