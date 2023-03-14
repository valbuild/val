import * as lens from "../lens";
import { getSelector, SelectorOf } from ".";
import { BaseSelector, LENS, Selector } from "./selector";
import { ArrayDescriptor, Descriptor, ValueOf } from "../lens/descriptor";

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
  constructor(
    readonly fromSrc: lens.Lens<Src, ValueOf<D>[]>,
    readonly item: D
  ) {
    super();
  }

  [LENS](): lens.Lens<Src, ValueOf<D>[]> {
    return this.fromSrc;
  }

  filter(
    predicate: <T>(item: SelectorOf<T, D>) => Selector<T, Descriptor>
  ): ArraySelector<Src, D> {
    const itemSelector = getSelector(lens.identity<ValueOf<D>>(), this.item);
    const predicateLens = predicate(itemSelector)[LENS]();
    const filter = lens.filter(predicateLens);
    return newArraySelector(lens.compose(this.fromSrc, filter), this.item);
  }

  find(
    predicate: <T>(item: SelectorOf<T, D>) => Selector<T, Descriptor>
  ): SelectorOf<Src, D> {
    const itemSelector = getSelector(lens.identity<ValueOf<D>>(), this.item);
    const predicateLens = predicate(itemSelector)[LENS]();
    const find = lens.find(predicateLens) as lens.Lens<
      ValueOf<D>[],
      // TODO: This ignores optionality of lens output
      ValueOf<D>
    >;
    return getSelector(lens.compose(this.fromSrc, find), this.item);
  }

  slice(start: number, end?: number | undefined): ArraySelector<Src, D> {
    return newArraySelector(
      lens.compose(this.fromSrc, lens.slice(start, end)),
      this.item
    );
  }
}

const proxyHandler: ProxyHandler<ArraySelectorC<unknown, Descriptor>> = {
  get(target, p) {
    if (typeof p === "string" && /^(0|[1-9][0-9]*)$/g.test(p)) {
      return getSelector(
        lens.compose(target.fromSrc, lens.prop(Number(p))),
        target.item
      );
    }
    return Reflect.get(ArraySelectorC, p, target);
  },
};

export function newArraySelector<Src, D extends Descriptor>(
  fromSrc: lens.Lens<Src, ValueOf<D>[]>,
  item: D
): ArraySelector<Src, D> {
  const proxy = new Proxy(new ArraySelectorC(fromSrc, item), proxyHandler);
  return proxy as unknown as ArraySelector<Src, D>;
}
