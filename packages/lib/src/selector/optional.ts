import {
  descriptorOf,
  DescriptorOf,
  exprOf,
  getSelector,
  Selected,
  SelectedOf,
  SelectorOf,
} from ".";
import {
  asRequired,
  AsRequired,
  Descriptor,
  DetailedOptionalDescriptor,
  NNDescriptor,
  ValueOf,
} from "../descriptor";
import * as expr from "../expr";
import { Selector, DESC, EXPR } from "./selector";

export class OptionalSelector<Ctx, D extends NNDescriptor> extends Selector<
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

  andThenAlt<E extends Descriptor>(
    callback: (v: SelectorOf<readonly [ValueOf<D>], D>) => SelectedOf<Ctx, E>
  ): OptionalSelector<Ctx, AsRequired<E>> {
    const vExpr = expr.fromCtx<readonly [ValueOf<D>], 0>(0);
    const selected = callback(getSelector(vExpr, this.item));
    return newOptionalSelector<Ctx, AsRequired<E>>(
      expr.andThen(
        this.expr,
        exprOf<readonly [ValueOf<D>], SelectedOf<Ctx, E>>(selected)
      ) as expr.Expr<Ctx, ValueOf<AsRequired<E>> | null>,
      asRequired(descriptorOf<readonly [ValueOf<D>], S>(selected))
    );
  }
}

export function newOptionalSelector<Ctx, D extends NNDescriptor>(
  expr: expr.Expr<Ctx, ValueOf<D> | null>,
  desc: D
): OptionalSelector<Ctx, D> {
  return new OptionalSelector(expr, desc);
}
