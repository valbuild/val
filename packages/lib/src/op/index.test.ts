import { compose, fromString, Op, prop } from ".";

describe("prop", () => {
  test("object", () => {
    const input = { foo: "bar" };
    const op = prop<"foo", typeof input>("foo");
    expect(op.apply(input)).toEqual("bar");
  });

  test("array", () => {
    const input = ["foo"];
    const op = prop<number, typeof input>(0);
    expect(op.apply(input)).toEqual("foo");
  });
});

test.each<{
  name: string;
  op: Op<unknown, unknown>;
}>([
  {
    name: "string prop",
    op: prop("foo"),
  },
  {
    name: "number prop",
    op: prop(0),
  },
  {
    name: "prop of prop",
    op: compose(prop("foo"), prop("bar")),
  },
])("serialization of $name", ({ op }) => {
  expect(fromString(op.toString("input"))).toEqual(["input", op]);
});
