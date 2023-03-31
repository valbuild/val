import * as expr from "../expr";
import {
  descriptorOf,
  DescriptorOf,
  exprOf,
  getSelector,
  Selected,
  SelectorOf,
} from ".";
import { Selector, DESC, EXPR } from "./selector";
import {
  asOptional,
  AsOptional,
  Descriptor,
  DetailedArrayDescriptor,
  NumberDescriptor,
  ValueOf,
} from "../descriptor";

interface ArraySelectorMethods<Ctx, D extends Descriptor> {
  filter(
    predicate: <T>(v: SelectorOf<T, D>) => Selector<T, Descriptor>
  ): ArraySelector<Ctx, D>;

  find(
    predicate: <T>(item: SelectorOf<T, D>) => Selector<T, Descriptor>
  ): SelectorOf<Ctx, AsOptional<D>>;

  slice(begin: number, end?: number): ArraySelector<Ctx, D>;

  sortBy(
    keyFn: <A>(v: SelectorOf<A, D>) => Selector<A, NumberDescriptor>
  ): ArraySelector<Ctx, D>;

  reverse(): ArraySelector<Ctx, D>;

  map<S extends Selected<readonly [ValueOf<D>, number]>>(
    callback: (
      v: SelectorOf<readonly [ValueOf<D>, number], D>,
      i: SelectorOf<readonly [ValueOf<D>, number], NumberDescriptor>
    ) => S
  ): ArraySelector<Ctx, DescriptorOf<readonly [ValueOf<D>, number], S>>;
}

export type ArraySelector<Ctx, D extends Descriptor> = Selector<
  Ctx,
  DetailedArrayDescriptor<D>
> &
  ArraySelectorMethods<Ctx, D> & {
    readonly [index: number]: SelectorOf<Ctx, D>;
  };

class ArraySelectorC<Ctx, D extends Descriptor>
  extends Selector<Ctx, DetailedArrayDescriptor<D>>
  implements ArraySelectorMethods<Ctx, D>
{
  constructor(
    readonly expr: expr.Expr<Ctx, readonly ValueOf<D>[]>,
    readonly item: D
  ) {
    super();
  }

  [EXPR](): expr.Expr<Ctx, ValueOf<DetailedArrayDescriptor<D>>> {
    return this.expr;
  }
  [DESC](): DetailedArrayDescriptor<D> {
    return {
      type: "array",
      item: this.item,
    };
  }

  filter(
    predicate: <Ctx>(v: SelectorOf<Ctx, D>) => Selector<Ctx, Descriptor>
  ): ArraySelector<Ctx, D> {
    const vExpr = expr.fromCtx<readonly [ValueOf<D>], 0>(0);
    const predicateExpr = predicate(getSelector(vExpr, this.item))[EXPR]();
    return newArraySelector(expr.filter(this.expr, predicateExpr), this.item);
  }

  find(
    predicate: <T>(item: SelectorOf<T, D>) => Selector<T, Descriptor>
  ): SelectorOf<Ctx, AsOptional<D>> {
    const vExpr = expr.fromCtx<readonly [ValueOf<D>], 0>(0);
    const predicateExpr = predicate(getSelector(vExpr, this.item))[EXPR]();
    const e = expr.find(this.expr, predicateExpr) as expr.Expr<
      Ctx,
      ValueOf<AsOptional<D>>
    >;
    return getSelector<Ctx, AsOptional<D>>(e, asOptional(this.item));
  }

  slice(start: number, end?: number | undefined): ArraySelector<Ctx, D> {
    return newArraySelector(expr.slice(this.expr, start, end), this.item);
  }

  sortBy(
    keyFn: <Ctx>(v: SelectorOf<Ctx, D>) => Selector<Ctx, NumberDescriptor>
  ): ArraySelector<Ctx, D> {
    const vExpr = expr.fromCtx<readonly [ValueOf<D>], 0>(0);
    const keyFnExpr = keyFn(getSelector(vExpr, this.item))[EXPR]();
    return newArraySelector(expr.sortBy(this.expr, keyFnExpr), this.item);
  }

  reverse(): ArraySelector<Ctx, D> {
    return newArraySelector(expr.reverse(this.expr), this.item);
  }

  map<S extends Selected<readonly [ValueOf<D>, number]>>(
    callback: (
      v: SelectorOf<readonly [ValueOf<D>, number], D>,
      i: SelectorOf<readonly [ValueOf<D>, number], NumberDescriptor>
    ) => S
  ): ArraySelector<Ctx, DescriptorOf<readonly [ValueOf<D>, number], S>> {
    const vExpr = expr.fromCtx<readonly [ValueOf<D>, number], 0>(0);
    const iExpr = expr.fromCtx<readonly [ValueOf<D>, number], 1>(1);
    const selected = callback(
      getSelector(vExpr, this.item),
      getSelector(iExpr, NumberDescriptor)
    );
    return newArraySelector(
      expr.map(this.expr, exprOf(selected)),
      descriptorOf(selected)
    );
  }
}

const proxyHandler: ProxyHandler<ArraySelectorC<unknown, Descriptor>> = {
  get(target, p) {
    if (typeof p === "string" && /^(-?0|[1-9][0-9]*)$/g.test(p)) {
      return getSelector(expr.item(target.expr, Number(p)), target.item);
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
