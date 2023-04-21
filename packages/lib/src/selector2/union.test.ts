import {
  ArrayDescriptor,
  LiteralDescriptor,
  ObjectDescriptor,
  StringDescriptor,
  UnionDescriptor,
} from "../descriptor2";
import { fromCtx } from "../expr";
import { newSelector } from ".";
import { match } from "./union";

test("match", () => {
  type InnerV = {
    foo: string;
    barProp: string;
  };
  type FooV = {
    d: "foo";
    fooProp: InnerV;
  };
  type BarV = {
    d: "bar";
    barProp: InnerV;
  };
  const innerD = ObjectDescriptor.create<InnerV>({
    foo: StringDescriptor,
    barProp: StringDescriptor,
  });
  const unionD = UnionDescriptor.create<FooV | BarV>([
    ObjectDescriptor.create<FooV>({
      d: LiteralDescriptor.create("foo"),
      fooProp: innerD,
    }),
    ObjectDescriptor.create<BarV>({
      d: LiteralDescriptor.create("bar"),
      barProp: innerD,
    }),
  ]);

  const expr = fromCtx<never, 0>(0);
  const selector = newSelector<FooV | BarV, never>(unionD, expr);

  const matched = match(selector, "d", {
    foo(v) {
      return v.fooProp;
    },
    bar(v) {
      return v.barProp;
    },
  });
});

test("disambiguate", () => {
  type A = {
    eq: {
      hello: string;
    };
  };
  const aD = ObjectDescriptor.create<A>({
    eq: ObjectDescriptor.create<{
      hello: string;
    }>({
      hello: StringDescriptor,
    }),
  });
  type B = A[];
  const bD = ArrayDescriptor.create<A>(aD);

  const expr = fromCtx<never, 0>(0);
  const selector = newSelector<B, never>(bD, expr);

  const asdf = selector.map((v) => v.eq);
});
