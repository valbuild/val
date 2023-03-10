import { prop } from ".";

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
