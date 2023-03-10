import * as lens from "../lens";
import type { Schema } from "../schema/Schema";
import { Source } from "../Source";
import { getSelector, SelectorOf } from ".";
import { BaseSelector, LENS, Selector } from "./selector";

interface ArraySelectorMethods<Src, T extends Schema<Source, unknown>> {
  filter(
    predicate: (
      item: SelectorOf<lens.OutOf<T>, T>
    ) => Selector<lens.OutOf<T>, unknown>
  ): ArraySelector<Src, T>;

  /* find(
    predicate: (item: SelectorOf<Out, T>) => Selector<Out, unknown>
  ): SelectorOf<Src, T>; */
}

export type ArraySelector<Src, T extends Schema<Source, unknown>> = Selector<
  Src,
  lens.OutOf<T>[]
> &
  ArraySelectorMethods<Src, T> & {
    readonly [index: number]: SelectorOf<Src, T>;
  };

class ArraySelectorC<Src, T extends Schema<Source, unknown>>
  extends BaseSelector<Src, lens.OutOf<T>[]>
  implements ArraySelectorMethods<Src, T>
{
  constructor(
    readonly fromSrc: lens.Lens<Src, lens.InOf<T>[]>,
    readonly schema: T,
    private readonly predicate?: lens.Lens<lens.OutOf<T>, unknown>
  ) {
    super();
  }

  [LENS](): lens.Lens<Src, lens.OutOf<T>[]> {
    return lens.compose(
      this.fromSrc,
      {
        apply: (input: lens.InOf<T>[]): lens.OutOf<T>[] => {
          return input.map((item) => this.schema.apply(item) as lens.OutOf<T>);
        },
      },
      this.predicate ? lens.filter(this.predicate) : lens.identity()
    );
  }

  filter(
    predicate: (
      item: SelectorOf<lens.OutOf<T>, T>
    ) => Selector<lens.OutOf<T>, unknown>
  ): ArraySelector<Src, T> {
    return newArraySelector<Src, T>(
      this.fromSrc,
      this.schema,
      // TODO: Combine with previous predicate
      predicate
    );
  }

  /* find(
    predicate: (item: SelectorOf<Out, T>) => Selector<Out, unknown>
  ): SelectorOf<Src, T> {
    return getSelector(
      lens.compose(this.fromSrc, lens.find(predicate)),
      this.schema
    );
  } */
}

const proxyHandler: ProxyHandler<
  ArraySelectorC<unknown, Schema<Source, unknown>>
> = {
  get(target, p) {
    if (typeof p === "string" && /^(0|[1-9][0-9]*)$/g.test(p)) {
      return getSelector(
        lens.compose(target.fromSrc, lens.prop(Number(p))),
        target.schema
      );
    }
    return Reflect.get(ArraySelectorC, p, target);
  },
};

export function newArraySelector<Src, T extends Schema<Source, unknown>>(
  fromSrc: lens.Lens<Src, lens.InOf<T>[]>,
  schema: T,
  predicate?: lens.Lens<lens.OutOf<T>, unknown>
): ArraySelector<Src, T> {
  const proxy = new Proxy(
    new ArraySelectorC(fromSrc, schema, predicate),
    proxyHandler
  );
  return proxy as unknown as ArraySelector<Src, T>;
}
