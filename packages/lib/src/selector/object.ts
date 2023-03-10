import * as lens from "../lens";
import { getSelector, SelectorOf } from ".";
import type { InObject, OutObject, SchemaObject } from "../schema/object";
import { BaseSelector, LENS, Selector } from "./selector";

export type ObjectSelector<Src, T extends SchemaObject> = Selector<
  Src,
  OutObject<T>
> & {
  readonly [P in keyof T]: SelectorOf<Src, T[P]>;
  // readonly [P in keyof T]: ReturnType<T[P]["select"]>;
};

class ObjectSelectorC<Src, T extends SchemaObject> extends BaseSelector<
  Src,
  OutObject<T>
> {
  constructor(
    readonly fromSrc: lens.Lens<Src, InObject<T>>,
    readonly schema: T
  ) {
    super();
  }

  [LENS](): lens.Lens<Src, OutObject<T>> {
    return lens.compose(this.fromSrc, {
      apply: (input: InObject<T>): OutObject<T> => {
        return Object.fromEntries(
          Object.entries(this.schema).map(([key, schema]) => [
            key,
            schema.apply(input[key]),
          ])
        ) as OutObject<T>;
      },
    });
  }
}

const proxyHandler: ProxyHandler<ObjectSelectorC<unknown, SchemaObject>> = {
  get(target, p, receiver) {
    if (
      typeof p === "string" &&
      Object.prototype.hasOwnProperty.call(target.schema, p)
    ) {
      return getSelector(
        lens.compose(target.fromSrc, lens.prop(p)),
        target.schema[p]
      );
    }
    return Reflect.get(ObjectSelectorC, p, receiver);
  },
};

export function newObjectSelector<Src, T extends SchemaObject>(
  fromSrc: lens.Lens<Src, InObject<T>>,
  schema: T
): ObjectSelector<Src, T> {
  const proxy = new Proxy(new ObjectSelectorC(fromSrc, schema), proxyHandler);
  return proxy as unknown as ObjectSelector<Src, T>;
}
