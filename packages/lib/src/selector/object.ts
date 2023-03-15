import * as op from "../op";
import { getSelector, SelectorOf } from ".";
import { BaseSelector, OP, Selector } from "./selector";
import { ObjectDescriptorProps, ValueOf } from "../descriptor";

type ValuesOf<D extends ObjectDescriptorProps> = {
  [P in keyof D]: ValueOf<D[P]>;
};

export type ObjectSelector<Src, D extends ObjectDescriptorProps> = Selector<
  Src,
  ValuesOf<D>
> & {
  readonly [P in keyof D]: SelectorOf<Src, D[P]>;
};

class ObjectSelectorC<
  Src,
  D extends ObjectDescriptorProps
> extends BaseSelector<Src, ValuesOf<D>> {
  constructor(readonly fromSrc: op.Op<Src, ValuesOf<D>>, readonly props: D) {
    super();
  }

  [OP](): op.Op<Src, ValuesOf<D>> {
    return this.fromSrc;
  }
}

const proxyHandler: ProxyHandler<
  ObjectSelectorC<unknown, ObjectDescriptorProps>
> = {
  get(target, p) {
    if (
      typeof p === "string" &&
      Object.prototype.hasOwnProperty.call(target.props, p)
    ) {
      return getSelector(
        op.compose(target.fromSrc, op.prop(p)),
        target.props[p]
      );
    }
    return Reflect.get(ObjectSelectorC, p, target);
  },
};

export function newObjectSelector<Src, D extends ObjectDescriptorProps>(
  fromSrc: op.Op<Src, ValuesOf<D>>,
  props: D
): ObjectSelector<Src, D> {
  const proxy = new Proxy(new ObjectSelectorC(fromSrc, props), proxyHandler);
  return proxy as unknown as ObjectSelector<Src, D>;
}
