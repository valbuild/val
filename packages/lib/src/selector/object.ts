import * as lens from "../lens";
import { getSelector, SelectorOf } from ".";
import { BaseSelector, LENS, Selector } from "./selector";
import { ObjectDescriptorProps, ValueOf } from "../lens/descriptor";

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
  constructor(
    readonly fromSrc: lens.Lens<Src, ValuesOf<D>>,
    readonly props: D
  ) {
    super();
  }

  [LENS](): lens.Lens<Src, ValuesOf<D>> {
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
        lens.compose(target.fromSrc, lens.prop(p)),
        target.props[p]
      );
    }
    return Reflect.get(ObjectSelectorC, p, target);
  },
};

export function newObjectSelector<Src, D extends ObjectDescriptorProps>(
  fromSrc: lens.Lens<Src, ValuesOf<D>>,
  props: D
): ObjectSelector<Src, D> {
  const proxy = new Proxy(new ObjectSelectorC(fromSrc, props), proxyHandler);
  return proxy as unknown as ObjectSelector<Src, D>;
}
