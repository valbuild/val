import {
  ArrayDescriptor,
  Descriptor,
  ObjectDescriptor,
  StringDescriptor,
} from "../descriptor2";
import { fromCtx } from "../expr";
import { newSelector } from ".";

test("array stuff", () => {
  type V = {
    foo: string;
  }[];
  const desc: Descriptor<V> = ArrayDescriptor.create(
    ObjectDescriptor.create<{
      foo: string;
    }>({
      foo: StringDescriptor,
    })
  );
  const expr = fromCtx<never, 0>(0);
  const selector = newSelector(desc, expr);
  const asdf = selector.map<string>((v) => v.foo).find((v) => v.eq("hello"));
});
