import { content } from "./content";
import { object } from "./schema/object";
import { string } from "./schema/string";
import { useVal } from "./useVal";
import { ValObject, ValString } from "./Val";

describe("useVal", () => {
  test("extracts ValString from string", () => {
    const val: ValString = useVal(content("foo", () => string().static("bar")));
    expect(val).toStrictEqual<ValString>({
      val: "bar",
      id: "foo",
    });
  });

  test("extracts ValString from ValObject", () => {
    const val: ValObject<{ foo: string }> = useVal(
      content("baz", () => object({ foo: string() }).static({ foo: "bar" }))
    );
    expect(val.foo).toStrictEqual<ValString>({
      id: "baz.foo",
      val: "bar",
    });
    // expect(val).toStrictEqual<ValObject<{ foo: string }>>({
    //   foo: {
    //     id: "baz.foo",
    //     val: "bar",
    //   },
    // });
  });
});
