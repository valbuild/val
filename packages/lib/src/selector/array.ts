import * as op from "../op";
import { getSelector, SelectorOf } from ".";
import { BaseSelector, OP, Selector } from "./selector";
import { Descriptor, ValueOf } from "../descriptor";

interface ArraySelectorMethods<Src, D extends Descriptor> {
  filter(
    predicate: <T>(item: SelectorOf<T, D>) => Selector<T, Descriptor>
  ): ArraySelector<Src, D>;

  // TODO: Optionals!
  find(
    predicate: <T>(item: SelectorOf<T, D>) => Selector<T, Descriptor>
  ): SelectorOf<Src, D>;

  slice(begin: number, end?: number): ArraySelector<Src, D>;
}

export type ArraySelector<Src, D extends Descriptor> = Selector<
  Src,
  ValueOf<D>[]
> &
  ArraySelectorMethods<Src, D> & {
    readonly [index: number]: SelectorOf<Src, D>;
  };

class ArraySelectorC<Src, D extends Descriptor>
  extends BaseSelector<Src, ValueOf<D>[]>
  implements ArraySelectorMethods<Src, D>
{
  constructor(readonly fromSrc: op.Op<Src, ValueOf<D>[]>, readonly item: D) {
    super();
  }

  [OP](): op.Op<Src, ValueOf<D>[]> {
    return this.fromSrc;
  }

  filter(
    predicate: <T>(item: SelectorOf<T, D>) => Selector<T, Descriptor>
  ): ArraySelector<Src, D> {
    const itemSelector = getSelector(op.identity<ValueOf<D>>(), this.item);
    const predicateOp = predicate(itemSelector)[OP]();
    const filter = op.filter(predicateOp);
    return newArraySelector(op.compose(this.fromSrc, filter), this.item);
  }

  find(
    predicate: <T>(item: SelectorOf<T, D>) => Selector<T, Descriptor>
  ): SelectorOf<Src, D> {
    const itemSelector = getSelector(op.identity<ValueOf<D>>(), this.item);
    const predicateOp = predicate(itemSelector)[OP]();
    const find = op.find(predicateOp) as op.Op<
      ValueOf<D>[],
      // TODO: This ignores optionality of op output
      ValueOf<D>
    >;
    return getSelector(op.compose(this.fromSrc, find), this.item);
  }

  slice(start: number, end?: number | undefined): ArraySelector<Src, D> {
    return newArraySelector(
      op.compose(this.fromSrc, op.slice(start, end)),
      this.item
    );
  }
}

const proxyHandler: ProxyHandler<ArraySelectorC<unknown, Descriptor>> = {
  get(target, p) {
    if (typeof p === "string" && /^(0|[1-9][0-9]*)$/g.test(p)) {
      return getSelector(
        op.compose(target.fromSrc, op.prop(Number(p))),
        target.item
      );
    }
    return Reflect.get(ArraySelectorC, p, target);
  },
};

export function newArraySelector<Src, D extends Descriptor>(
  fromSrc: op.Op<Src, ValueOf<D>[]>,
  item: D
): ArraySelector<Src, D> {
  const proxy = new Proxy(new ArraySelectorC(fromSrc, item), proxyHandler);
  return proxy as unknown as ArraySelector<Src, D>;
}
