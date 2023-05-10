import * as expr from "../expr";
import { getSelector, SelectorOf } from ".";
import { Selector, DESC, EXPR } from "./selector";
import { Descriptor, TupleDescriptor, ValueOf } from "../descriptor";
import { Source } from "../Source";

export type ValuesOf<D extends readonly Descriptor<Source>[]> = {
  readonly [I in keyof D]: ValueOf<D[I]>;
};

export type TupleSelector<
  D extends readonly Descriptor<Source>[],
  Ctx
> = Selector<TupleDescriptor<D>, Ctx> & {
  readonly [Index in keyof D]: SelectorOf<D[Index], Ctx>;
};

const test = null as unknown as TupleSelector<
  readonly [Descriptor<number>],
  any
>;
const a = test.filter;

class TupleSelectorC<
  D extends readonly Descriptor<Source>[],
  Ctx
> extends Selector<TupleDescriptor<D>, Ctx> {
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
  TupleSelectorC<readonly Descriptor<Source>[], unknown>
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

export function newTupleSelector<D extends readonly Descriptor<Source>[], Ctx>(
  expr: expr.Expr<Ctx, ValuesOf<D>>,
  items: D
): TupleSelector<D, Ctx> {
  const proxy = new Proxy(new TupleSelectorC(expr, items), proxyHandler);
  return proxy as unknown as TupleSelector<D, Ctx>;
}
