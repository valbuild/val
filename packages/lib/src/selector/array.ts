import * as lens from "../lens";
import { getSelector, SelectorOf } from ".";
import { BaseSelector, LENS, Selector } from "./selector";
import { ArrayDescriptor, Descriptor, ValueOf } from "../lens/descriptor";

interface ArraySelectorMethods<Src, D extends ArrayDescriptor> {
  filter(
    predicate: <T>(item: SelectorOf<T, D["item"]>) => Selector<T, Descriptor>
  ): ArraySelector<Src, D>;

  // TODO: Optionals!
  find(
    predicate: <T>(item: SelectorOf<T, D["item"]>) => Selector<T, Descriptor>
  ): SelectorOf<Src, D["item"]>;

  slice(begin: number, end?: number): ArraySelector<Src, D>;
}

export type ArraySelector<Src, D extends ArrayDescriptor> = Selector<Src, D> &
  ArraySelectorMethods<Src, D> & {
    readonly [index: number]: SelectorOf<Src, D["item"]>;
  };

class ArraySelectorC<Src, D extends ArrayDescriptor>
  extends BaseSelector<Src, D>
  implements ArraySelectorMethods<Src, D>
{
  constructor(readonly fromSrc: lens.Lens<Src, ValueOf<D>>, readonly desc: D) {
    super();
  }

  [LENS](): lens.Lens<Src, ValueOf<D>> {
    return this.fromSrc;
  }

  filter(
    predicate: <T>(item: SelectorOf<T, D["item"]>) => Selector<T, Descriptor>
  ): ArraySelector<Src, D> {
    const itemSelector = getSelector(
      lens.identity<ValueOf<D["item"]>>(),
      this.desc.item
    );
    const predicateLens = predicate(
      itemSelector as SelectorOf<ValueOf<D["item"]>, D["item"]>
    )[LENS]();
    const filter = lens.filter(predicateLens) as lens.Lens<
      ValueOf<D>,
      ValueOf<D>
    >;
    return newArraySelector(lens.compose(this.fromSrc, filter), this.desc);
  }

  find(
    predicate: <T>(item: SelectorOf<T, D["item"]>) => Selector<T, Descriptor>
  ): SelectorOf<Src, D["item"]> {
    const itemSelector = getSelector(
      lens.identity<ValueOf<D["item"]>>(),
      this.desc.item
    );
    const predicateLens = predicate(
      itemSelector as SelectorOf<ValueOf<D["item"]>, D["item"]>
    )[LENS]();
    const find = lens.find(predicateLens) as lens.Lens<
      ValueOf<D>,
      // TODO: This ignores optionality of lens output
      ValueOf<D["item"]>
    >;
    return getSelector(
      lens.compose(this.fromSrc, find),
      this.desc.item
    ) as SelectorOf<Src, D["item"]>;
  }

  slice(start: number, end?: number | undefined): ArraySelector<Src, D> {
    return newArraySelector(
      lens.compose(this.fromSrc, lens.slice(start, end)) as lens.Lens<
        ValueOf<D>,
        ValueOf<D>
      >,
      this.desc
    ) as ArraySelector<Src, D>;
  }
}

const proxyHandler: ProxyHandler<ArraySelectorC<unknown, ArrayDescriptor>> = {
  get(target, p) {
    if (typeof p === "string" && /^(0|[1-9][0-9]*)$/g.test(p)) {
      return getSelector(
        lens.compose<unknown, ValueOf<ArrayDescriptor>, ValueOf<Descriptor>>(
          target.fromSrc,
          lens.prop(Number(p))
        ),
        target.desc.item
      );
    }
    return Reflect.get(ArraySelectorC, p, target);
  },
};

export function newArraySelector<Src, D extends ArrayDescriptor>(
  fromSrc: lens.Lens<Src, ValueOf<D>>,
  desc: D
): ArraySelector<Src, D> {
  const proxy = new Proxy(new ArraySelectorC(fromSrc, desc), proxyHandler);
  return proxy as unknown as ArraySelector<Src, D>;
}
