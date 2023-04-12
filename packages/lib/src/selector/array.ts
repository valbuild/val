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
  ArrayDescriptor,
  NumberDescriptor,
  ValueOf,
} from "../descriptor";
import { Source } from "../Source";

export type ArraySelector<D extends Descriptor<Source>, Ctx> = Selector<
  ArrayDescriptor<D>,
  Ctx
> & {
  readonly [index: number]: SelectorOf<D, Ctx>;

  filter(
    predicate: <T>(v: SelectorOf<D, T>) => Selector<Descriptor<Source>, T>
  ): ArraySelector<D, Ctx>;

  find(
    predicate: <T>(item: SelectorOf<D, T>) => Selector<Descriptor<Source>, T>
  ): SelectorOf<AsOptional<D>, Ctx>;

  slice(begin: number, end?: number): ArraySelector<D, Ctx>;

  sortBy(
    keyFn: <A>(v: SelectorOf<D, A>) => Selector<NumberDescriptor, A>
  ): ArraySelector<D, Ctx>;

  reverse(): ArraySelector<D, Ctx>;

  map<S extends Selected<readonly [ValueOf<D>, number]>>(
    callback: (
      v: SelectorOf<D, readonly [ValueOf<D>, number]>,
      i: SelectorOf<NumberDescriptor, readonly [ValueOf<D>, number]>
    ) => S
  ): ArraySelector<DescriptorOf<S, readonly [ValueOf<D>, number]>, Ctx>;
};

class ArraySelectorC<D extends Descriptor<Source>, Ctx>
  extends Selector<ArrayDescriptor<D>, Ctx>
  implements ArraySelector<D, Ctx>
{
  constructor(
    readonly expr: expr.Expr<Ctx, readonly ValueOf<D>[]>,
    readonly item: D
  ) {
    super();
  }

  readonly [index: number]: never;

  [EXPR](): expr.Expr<Ctx, ValueOf<ArrayDescriptor<D>>> {
    return this.expr;
  }
  [DESC](): ArrayDescriptor<D> {
    return new ArrayDescriptor(this.item);
  }

  filter(
    predicate: <Ctx>(v: SelectorOf<D, Ctx>) => Selector<Descriptor<Source>, Ctx>
  ): ArraySelector<D, Ctx> {
    const vExpr = expr.fromCtx<readonly [ValueOf<D>], 0>(0);
    const predicateExpr = predicate(getSelector(vExpr, this.item))[EXPR]();
    return newArraySelector(expr.filter(this.expr, predicateExpr), this.item);
  }

  find(
    predicate: <T>(item: SelectorOf<D, T>) => Selector<Descriptor<Source>, T>
  ): SelectorOf<AsOptional<D>, Ctx> {
    const vExpr = expr.fromCtx<readonly [ValueOf<D>], 0>(0);
    const predicateExpr = predicate(getSelector(vExpr, this.item))[EXPR]();
    const e = expr.find(this.expr, predicateExpr) as expr.Expr<
      Ctx,
      ValueOf<AsOptional<D>>
    >;
    return getSelector<AsOptional<D>, Ctx>(e, asOptional(this.item));
  }

  slice(start: number, end?: number | undefined): ArraySelector<D, Ctx> {
    return newArraySelector(expr.slice(this.expr, start, end), this.item);
  }

  sortBy(
    keyFn: <Ctx>(v: SelectorOf<D, Ctx>) => Selector<NumberDescriptor, Ctx>
  ): ArraySelector<D, Ctx> {
    const vExpr = expr.fromCtx<readonly [ValueOf<D>], 0>(0);
    const keyFnExpr = keyFn(getSelector(vExpr, this.item))[EXPR]();
    return newArraySelector(expr.sortBy(this.expr, keyFnExpr), this.item);
  }

  reverse(): ArraySelector<D, Ctx> {
    return newArraySelector(expr.reverse(this.expr), this.item);
  }

  map<S extends Selected<readonly [ValueOf<D>, number]>>(
    callback: (
      v: SelectorOf<D, readonly [ValueOf<D>, number]>,
      i: SelectorOf<NumberDescriptor, readonly [ValueOf<D>, number]>
    ) => S
  ): ArraySelector<DescriptorOf<S, readonly [ValueOf<D>, number]>, Ctx> {
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

const proxyHandler: ProxyHandler<ArraySelectorC<Descriptor<Source>, unknown>> =
  {
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

export function newArraySelector<D extends Descriptor<Source>, Ctx>(
  expr: expr.Expr<Ctx, readonly ValueOf<D>[]>,
  item: D
): ArraySelector<D, Ctx> {
  const proxy = new Proxy(
    new ArraySelectorC<Descriptor<Source>, unknown>(expr, item),
    proxyHandler
  );
  return proxy as unknown as ArraySelector<D, Ctx>;
}
