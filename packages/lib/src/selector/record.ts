import * as expr from "../expr";
import { getSelector, SelectorOf } from ".";
import { Selector, DESC, EXPR } from "./selector";
import { Descriptor, RecordDescriptor, ValueOf } from "../descriptor";

export type RecordSelector<
  Ctx,
  K extends string,
  D extends Descriptor<unknown>
> = Selector<Ctx, RecordDescriptor<K, D>> & {
  readonly [P in string]: SelectorOf<Ctx, D>;
};

class RecordSelectorC<
  Ctx,
  K extends string,
  D extends Descriptor<unknown>
> extends Selector<Ctx, RecordDescriptor<K, D>> {
  constructor(
    readonly expr: expr.Expr<Ctx, ValueOf<RecordDescriptor<K, D>>>,
    readonly item: D
  ) {
    super();
  }

  [EXPR](): expr.Expr<Ctx, ValueOf<RecordDescriptor<K, D>>> {
    return this.expr;
  }
  [DESC](): RecordDescriptor<K, D> {
    return new RecordDescriptor(this.item);
  }
}

const proxyHandler: ProxyHandler<
  RecordSelectorC<unknown, string, Descriptor<unknown>>
> = {
  get(target, p) {
    if (typeof p !== "string") {
      throw Error("Cannot access non-string property of record");
    }
    return getSelector(expr.prop(target.expr, p), target.item);
  },
};

export function newRecordSelector<
  Ctx,
  K extends string,
  D extends Descriptor<unknown>
>(
  expr: expr.Expr<Ctx, Record<string, ValueOf<D>>>,
  item: D
): RecordSelector<Ctx, K, D> {
  const proxy = new Proxy(new RecordSelectorC(expr, item), proxyHandler);
  return proxy as unknown as RecordSelector<Ctx, K, D>;
}
