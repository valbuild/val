import * as expr from "../expr";
import { getSelector, SelectorOf } from ".";
import { BaseSelector, EXPR, Selector } from "./selector";
import { Descriptor, ValueOf } from "../descriptor";

interface ArraySelectorMethods<Ctx, D extends Descriptor> {
  filter(
    predicate: <T>(v: SelectorOf<T, D>) => Selector<T, unknown>
  ): ArraySelector<Ctx, D>;

  // TODO: Optionals!
  /* find(
    predicate: <T>(item: SelectorOf<T, D>) => Selector<T, Descriptor>
  ): SelectorOf<Ctx, D>; */

  slice(begin: number, end?: number): ArraySelector<Ctx, D>;

  sortBy(
    keyFn: <A>(v: SelectorOf<A, D>) => Selector<A, number>
  ): ArraySelector<Ctx, D>;

  sort(
    compareFn: <Ctx>(
      a: SelectorOf<Ctx, D>,
      b: SelectorOf<Ctx, D>
    ) => Selector<Ctx, number>
  ): ArraySelector<Ctx, D>;
}

export type ArraySelector<Ctx, D extends Descriptor> = Selector<
  Ctx,
  ValueOf<D>[]
> &
  ArraySelectorMethods<Ctx, D> & {
    readonly [index: number]: SelectorOf<Ctx, D>;
  };

class ArraySelectorC<Ctx, D extends Descriptor>
  extends BaseSelector<Ctx, ValueOf<D>[]>
  implements ArraySelectorMethods<Ctx, D>
{
  constructor(readonly expr: expr.Expr<Ctx, ValueOf<D>[]>, readonly item: D) {
    super();
  }

  [EXPR](): expr.Expr<Ctx, ValueOf<D>[]> {
    return this.expr;
  }

  filter(
    predicate: <Ctx>(v: SelectorOf<Ctx, D>) => Selector<Ctx, unknown>
  ): ArraySelector<Ctx, D> {
    const vSym = Symbol("v");
    const vExpr = expr.fromCtx<typeof vSym, ValueOf<D>>(vSym);
    const predicateExpr = predicate(getSelector(vExpr, this.item))[EXPR]();
    return newArraySelector(
      expr.filter(this.expr, vSym, predicateExpr),
      this.item
    );
  }

  /* find(
    predicate: <T>(item: SelectorOf<T, D>) => Selector<T, Descriptor>
  ): SelectorOf<Ctx, D> {
    const itemSelector = getSelector(op.identity<ValueOf<D>>(), this.item);
    const predicateOp = predicate(itemSelector)[EXPR]();
    const find = op.find(predicateOp) as expr.Expr<
      ValueOf<D>[],
      // TODO: This ignores optionality of op output
      ValueOf<D>
    >;
    return getSelector(op.compose(this.fromCtx, find), this.item);
  } */

  slice(start: number, end?: number | undefined): ArraySelector<Ctx, D> {
    return newArraySelector(expr.slice(this.expr, start, end), this.item);
  }

  sortBy(
    keyFn: <Ctx>(v: SelectorOf<Ctx, D>) => Selector<Ctx, number>
  ): ArraySelector<Ctx, D> {
    const vSym = Symbol("v");
    const vExpr = expr.fromCtx<typeof vSym, ValueOf<D>>(vSym);
    const keyFnExpr = keyFn(getSelector(vExpr, this.item))[EXPR]();
    return newArraySelector(expr.sortBy(this.expr, vSym, keyFnExpr), this.item);
  }

  sort(
    compareFn: <Ctx>(
      a: SelectorOf<Ctx, D>,
      b: SelectorOf<Ctx, D>
    ) => Selector<Ctx, number>
  ): ArraySelector<Ctx, D> {
    const aSym = Symbol("a");
    const aExpr = expr.fromCtx<typeof aSym, ValueOf<D>>(aSym);
    const bSym = Symbol("b");
    const bExpr = expr.fromCtx<typeof bSym, ValueOf<D>>(bSym);
    const compareFnExpr = compareFn<{
      [aSym]: ValueOf<D>;
      [bSym]: ValueOf<D>;
    }>(getSelector(aExpr, this.item), getSelector(bExpr, this.item))[EXPR]();
    return newArraySelector(
      expr.sort(this.expr, aSym, bSym, compareFnExpr),
      this.item
    );
  }
}

const proxyHandler: ProxyHandler<ArraySelectorC<unknown, Descriptor>> = {
  get(target, p) {
    if (typeof p === "string" && /^(0|[1-9][0-9]*)$/g.test(p)) {
      return getSelector(expr.prop(target.expr, Number(p)), target.item);
    }
    // Exclude own properties of target for public access, but bind methods such
    // that they may access own properties
    const result: unknown = Reflect.get(ArraySelectorC.prototype, p, target);
    return typeof result === "function" ? result.bind(target) : result;
  },
};

export function newArraySelector<Ctx, D extends Descriptor>(
  expr: expr.Expr<Ctx, ValueOf<D>[]>,
  item: D
): ArraySelector<Ctx, D> {
  const proxy = new Proxy(new ArraySelectorC(expr, item), proxyHandler);
  return proxy as unknown as ArraySelector<Ctx, D>;
}
