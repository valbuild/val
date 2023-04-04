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
  OptionalDescriptor,
  NonOptionalDescriptor,
  ValueOf,
} from "../descriptor";
import * as expr from "../expr";
import { Selector, DESC, EXPR } from "./selector";

export class OptionalSelector<
  Ctx,
  D extends NonOptionalDescriptor<unknown>
> extends Selector<Ctx, OptionalDescriptor<D>> {
  constructor(
    private readonly expr: expr.Expr<Ctx, ValueOf<OptionalDescriptor<D>>>,
    private readonly item: D
  ) {
    super();
  }

  [EXPR](): expr.Expr<Ctx, ValueOf<OptionalDescriptor<D>>> {
    return this.expr;
  }
  [DESC](): OptionalDescriptor<D> {
    return new OptionalDescriptor(this.item);
  }

  andThen<S extends Selected<readonly [ValueOf<D>]>>(
    callback: (v: SelectorOf<readonly [ValueOf<D>], D>) => S
  ): OptionalSelector<Ctx, AsRequired<DescriptorOf<readonly [ValueOf<D>], S>>> {
    const vExpr = expr.fromCtx<readonly [ValueOf<D>], 0>(0);
    const selected = callback(getSelector(vExpr, this.item));
    return newOptionalSelector<
      Ctx,
      AsRequired<DescriptorOf<readonly [ValueOf<D>], S>>
    >(
      expr.andThen(
        this.expr,
        exprOf<readonly [ValueOf<D>], S>(selected)
      ) as expr.Expr<
        Ctx,
        ValueOf<AsRequired<DescriptorOf<readonly [ValueOf<D>], S>>> | null
      >,
      asRequired(descriptorOf<readonly [ValueOf<D>], S>(selected))
    );
  }
}

export function newOptionalSelector<
  Ctx,
  D extends NonOptionalDescriptor<unknown>
>(expr: expr.Expr<Ctx, ValueOf<D> | null>, desc: D): OptionalSelector<Ctx, D> {
  return new OptionalSelector(expr, desc);
}
