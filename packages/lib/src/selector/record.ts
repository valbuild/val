import * as expr from "../expr";
import { getSelector, SelectorOf } from ".";
import { Selector, DESC, EXPR } from "./selector";
import { Descriptor, RecordDescriptor, ValueOf } from "../descriptor";
import { Source } from "../Source";

export type RecordSelector<
  K extends string,
  D extends Descriptor<Source>,
  Ctx
> = Selector<RecordDescriptor<K, D>, Ctx> & {
  readonly [P in string]: SelectorOf<D, Ctx>;
};

class RecordSelectorC<
  K extends string,
  D extends Descriptor<Source>,
  Ctx
> extends Selector<RecordDescriptor<K, D>, Ctx> {
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
  RecordSelectorC<string, Descriptor<Source>, unknown>
> = {
  get(target, p) {
    if (typeof p !== "string") {
      throw Error("Cannot access non-string property of record");
    }
    return getSelector(expr.prop(target.expr, p), target.item);
  },
};

export function newRecordSelector<
  K extends string,
  D extends Descriptor<Source>,
  Ctx
>(
  expr: expr.Expr<Ctx, Record<string, ValueOf<D>>>,
  item: D
): RecordSelector<K, D, Ctx> {
  const proxy = new Proxy(new RecordSelectorC(expr, item), proxyHandler);
  return proxy as unknown as RecordSelector<K, D, Ctx>;
}
