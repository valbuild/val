import * as expr from "../expr";
import { getSelector, SelectorOf } from ".";
import { Selector, DESC, EXPR } from "./selector";
import { Descriptor, TupleDescriptor, ValueOf } from "../descriptor";

export type ValuesOf<D extends readonly Descriptor<unknown>[]> = {
  readonly [I in keyof D]: ValueOf<D[I]>;
};

export type TupleSelector<
  Ctx,
  D extends readonly Descriptor<unknown>[]
> = Selector<Ctx, TupleDescriptor<D>> & {
  readonly [Index in keyof D]: SelectorOf<Ctx, D[Index]>;
};

class TupleSelectorC<
  Ctx,
  D extends readonly Descriptor<unknown>[]
> extends Selector<Ctx, TupleDescriptor<D>> {
  constructor(readonly expr: expr.Expr<Ctx, ValuesOf<D>>, readonly items: D) {
    super();
  }

  [EXPR](): expr.Expr<Ctx, ValuesOf<D>> {
    return this.expr;
  }
  [DESC](): TupleDescriptor<D> {
    return new TupleDescriptor(this.items);
  }
}

const proxyHandler: ProxyHandler<
  TupleSelectorC<unknown, readonly Descriptor<unknown>[]>
> = {
  get(target, p) {
    if (typeof p === "string" && /^(-?0|[1-9][0-9]*)$/g.test(p)) {
      return getSelector(
        expr.item(target.expr, Number(p)),
        target.items[Number(p)]
      );
    }
    // Exclude own properties of target for public access, but bind methods such
    // that they may access own properties
    const result: unknown = Reflect.get(TupleSelectorC.prototype, p, target);

    return typeof result === "function" ? result.bind(target) : result;
  },
};

export function newTupleSelector<Ctx, D extends readonly Descriptor<unknown>[]>(
  expr: expr.Expr<Ctx, ValuesOf<D>>,
  items: D
): TupleSelector<Ctx, D> {
  const proxy = new Proxy(new TupleSelectorC(expr, items), proxyHandler);
  return proxy as unknown as TupleSelector<Ctx, D>;
}
