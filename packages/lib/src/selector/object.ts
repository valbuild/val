import * as expr from "../expr";
import { getSelector, SelectorOf } from ".";
import { Selector, DESC, EXPR } from "./selector";
import {
  ObjectDescriptor,
  ObjectDescriptorProps,
  ValueOf,
} from "../descriptor";

type ValuesOf<D extends ObjectDescriptorProps> = {
  [P in keyof D]: ValueOf<D[P]>;
};

export type ObjectSelector<Ctx, D extends ObjectDescriptorProps> = Selector<
  Ctx,
  ObjectDescriptor<D>
> & {
  readonly [P in keyof D]: SelectorOf<Ctx, D[P]>;
};

class ObjectSelectorC<Ctx, D extends ObjectDescriptorProps> extends Selector<
  Ctx,
  ObjectDescriptor<D>
> {
  constructor(
    readonly expr: expr.Expr<Ctx, ValueOf<ObjectDescriptor<D>>>,
    readonly props: D
  ) {
    super();
  }

  [EXPR](): expr.Expr<Ctx, ValueOf<ObjectDescriptor<D>>> {
    return this.expr;
  }
  [DESC](): ObjectDescriptor<D> {
    return new ObjectDescriptor(this.props);
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
      return getSelector(expr.prop(target.expr, p), target.props[p]);
    }
    // Exclude own properties of target for public access, but bind methods such
    // that they may access own properties
    const result: unknown = Reflect.get(ObjectSelectorC.prototype, p, target);
    return typeof result === "function" ? result.bind(target) : result;
  },
};

export function newObjectSelector<Ctx, D extends ObjectDescriptorProps>(
  expr: expr.Expr<Ctx, ValuesOf<D>>,
  props: D
): ObjectSelector<Ctx, D> {
  const proxy = new Proxy(new ObjectSelectorC(expr, props), proxyHandler);
  return proxy as unknown as ObjectSelector<Ctx, D>;
}
