import { useVal } from "./useVal";
import { initVal, ValObject, ValString } from "@valcms/lib";

const { s, val } = initVal();

describe("useVal", () => {
  test("extracts ValString from string", () => {
    const vs: ValString = useVal(
      val.content("foo", () => s.string().static("bar"))
    );
    expect(vs).toStrictEqual<ValString>({
      val: "bar",
      valId: "foo",
    });
  });

  test("extracts ValString from ValObject", () => {
    const vo: ValObject<{ foo: string }> = useVal(
      val.content("baz", () =>
        s.object({ foo: s.string() }).static({ foo: "bar" })
      )
    );
    expect(vo.foo).toStrictEqual<ValString>({
      valId: "baz.foo",
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
