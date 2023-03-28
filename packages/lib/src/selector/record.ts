import * as expr from "../expr";
import { getSelector, SelectorOf } from ".";
import { BaseSelector, DESC, EXPR, Selector } from "./selector";
import { Descriptor, DetailedRecordDescriptor, ValueOf } from "../descriptor";

export type RecordSelector<Ctx, D extends Descriptor> = Selector<
  Ctx,
  Record<string, ValueOf<D>>
> & {
  readonly [P in string]: SelectorOf<Ctx, D>;
};

class RecordSelectorC<Ctx, D extends Descriptor> extends BaseSelector<
  Ctx,
  Record<string, ValueOf<D>>
> {
  constructor(
    readonly expr: expr.Expr<Ctx, Record<string, ValueOf<D>>>,
    readonly item: D
  ) {
    super();
  }

  [EXPR](): expr.Expr<Ctx, Record<string, ValueOf<D>>> {
    return this.expr;
  }
  [DESC](): DetailedRecordDescriptor<D> {
    return {
      type: "record",
      item: this.item,
    };
  }
}

const proxyHandler: ProxyHandler<RecordSelectorC<unknown, Descriptor>> = {
  get(target, p) {
    if (typeof p !== "string") {
      throw Error("Cannot access non-string property of record");
    }
    return getSelector(expr.prop(target.expr, p), target.item);
  },
};

export function newRecordSelector<Ctx, D extends Descriptor>(
  expr: expr.Expr<Ctx, Record<string, ValueOf<D>>>,
  item: D
): RecordSelector<Ctx, D> {
  const proxy = new Proxy(new RecordSelectorC(expr, item), proxyHandler);
  return proxy as unknown as RecordSelector<Ctx, D>;
}
