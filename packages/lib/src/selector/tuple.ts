import * as expr from "../expr";
import { getSelector, SelectorOf } from ".";
import { Selector, DESC, EXPR } from "./selector";
import { Descriptor, DetailedTupleDescriptor, ValueOf } from "../descriptor";

export type ValuesOf<D extends readonly Descriptor[]> = {
  [P in keyof D]: ValueOf<D[P]>;
};

export type TupleSelector<Ctx, D extends readonly Descriptor[]> = Selector<
  Ctx,
  DetailedTupleDescriptor<D>
> & {
  readonly [Index in keyof D]: SelectorOf<Ctx, D[Index]>;
};

class TupleSelectorC<Ctx, D extends readonly Descriptor[]> extends Selector<
  Ctx,
  DetailedTupleDescriptor<D>
> {
  constructor(readonly expr: expr.Expr<Ctx, ValuesOf<D>>, readonly items: D) {
    super();
  }

  [EXPR](): expr.Expr<Ctx, ValuesOf<D>> {
    return this.expr;
  }
  [DESC](): DetailedTupleDescriptor<D> {
    return {
      type: "tuple",
      items: this.items,
    };
  }
}

const proxyHandler: ProxyHandler<
  TupleSelectorC<unknown, readonly Descriptor[]>
> = {
  get(target, p) {
    if (typeof p === "string" && /^(0|[1-9][0-9]*)$/g.test(p)) {
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

export function newTupleSelector<Ctx, DS extends readonly Descriptor[]>(
  expr: expr.Expr<Ctx, ValuesOf<DS>>,
  items: DS
): TupleSelector<Ctx, DS> {
  const proxy = new Proxy(new TupleSelectorC(expr, items), proxyHandler);
  return proxy as unknown as TupleSelector<Ctx, DS>;
}
