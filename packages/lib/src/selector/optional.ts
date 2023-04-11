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
import { Source } from "../Source";
import { Selector, DESC, EXPR } from "./selector";

export class OptionalSelector<
  D extends NonOptionalDescriptor<Source>,
  Ctx
> extends Selector<OptionalDescriptor<D>, Ctx> {
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
    callback: (v: SelectorOf<D, readonly [ValueOf<D>]>) => S
  ): OptionalSelector<AsRequired<DescriptorOf<S, readonly [ValueOf<D>]>>, Ctx> {
    const vExpr = expr.fromCtx<readonly [ValueOf<D>], 0>(0);
    const selected = callback(getSelector(vExpr, this.item));
    return newOptionalSelector<
      AsRequired<DescriptorOf<S, readonly [ValueOf<D>]>>,
      Ctx
    >(
      expr.andThen(
        this.expr,
        exprOf<readonly [ValueOf<D>], S>(selected)
      ) as expr.Expr<
        Ctx,
        ValueOf<AsRequired<DescriptorOf<S, readonly [ValueOf<D>]>>> | null
      >,
      asRequired(descriptorOf<S, readonly [ValueOf<D>]>(selected))
    );
  }
}

export function newOptionalSelector<
  D extends NonOptionalDescriptor<Source>,
  Ctx
>(expr: expr.Expr<Ctx, ValueOf<D> | null>, desc: D): OptionalSelector<D, Ctx> {
  return new OptionalSelector(expr, desc);
}
