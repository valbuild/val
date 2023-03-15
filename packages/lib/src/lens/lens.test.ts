import { compose, fromString, Lens, prop } from ".";

describe("prop", () => {
  test("object", () => {
    const input = { foo: "bar" };
    const lens = prop<"foo", typeof input>("foo");
    expect(lens.apply(input)).toEqual("bar");
  });

  test("array", () => {
    const input = ["foo"];
    const lens = prop<number, typeof input>(0);
    expect(lens.apply(input)).toEqual("foo");
  });
});

test.each<{
  name: string;
  lens: Lens<unknown, unknown>;
}>([
  {
    name: "string prop",
    lens: prop("foo"),
  },
  {
    name: "number prop",
    lens: prop(0),
  },
  {
    name: "prop of prop",
    lens: compose(prop("foo"), prop("bar")),
  },
])("serialization of $name", ({ lens }) => {
  expect(fromString(lens.toString("input"))).toEqual(["input", lens]);
});
