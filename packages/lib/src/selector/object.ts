import * as lens from "../lens";
import { getSelector, SelectorOf } from ".";
import { BaseSelector, LENS, Selector } from "./selector";
import { ObjectDescriptor, ValueOf } from "../lens/descriptor";

export type ObjectSelector<Src, D extends ObjectDescriptor> = Selector<
  Src,
  ValueOf<D>
> & {
  readonly [P in keyof D["props"]]: SelectorOf<Src, D["props"][P]>;
};

class ObjectSelectorC<Src, D extends ObjectDescriptor> extends BaseSelector<
  Src,
  ValueOf<D>
> {
  constructor(readonly fromSrc: lens.Lens<Src, ValueOf<D>>, readonly desc: D) {
    super();
  }

  [LENS](): lens.Lens<Src, ValueOf<D>> {
    return this.fromSrc;
  }
}

const proxyHandler: ProxyHandler<ObjectSelectorC<unknown, ObjectDescriptor>> = {
  get(target, p) {
    if (
      typeof p === "string" &&
      Object.prototype.hasOwnProperty.call(target.desc.props, p)
    ) {
      return getSelector(
        lens.compose(target.fromSrc, lens.prop(p)),
        target.desc.props[p]
      );
    }
    return Reflect.get(ObjectSelectorC, p, target);
  },
};

export function newObjectSelector<Src, D extends ObjectDescriptor>(
  fromSrc: lens.Lens<Src, ValueOf<D>>,
  desc: D
): ObjectSelector<Src, D> {
  const proxy = new Proxy(new ObjectSelectorC(fromSrc, desc), proxyHandler);
  return proxy as unknown as ObjectSelector<Src, D>;
}
