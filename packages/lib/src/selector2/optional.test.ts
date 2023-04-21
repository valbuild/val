import {
  NullDescriptor,
  ObjectDescriptor,
  StringDescriptor,
  UnionDescriptor,
} from "../descriptor2";
import { fromCtx } from "../expr";
import { newSelector } from ".";
import { andThen } from "./optional";

test("andThen", () => {
  type A = {
    foo: string;
  };
  const aD = ObjectDescriptor.create<A>({
    foo: StringDescriptor,
  });
  const d = UnionDescriptor.create<A | null>([aD, NullDescriptor]);
  const selector = newSelector<A | null, never>(d, fromCtx<never, 0>(0));

  const asdf = andThen(selector, (v) => v.foo);
});
