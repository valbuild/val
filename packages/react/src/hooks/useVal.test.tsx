import { useVal } from "./useVal";
import { initVal, ValObject, ValString } from "@valbuild/lib";
import { renderHook } from "@testing-library/react";
import { ValContext } from "../ValProvider";
import { ReactElement } from "react";
import { ValStore } from "../ValStore";
import { ValApi } from "../ValApi";

const valApi = new ValApi("mock");
const valStore = new ValStore(valApi);

const Providers = ({ children }: { children: ReactElement }) => (
  <ValContext.Provider
    value={{
      valStore,
      valApi,
    }}
  >
    {children}
  </ValContext.Provider>
);

const { s, val } = initVal();

describe("useVal", () => {
  test("extracts ValString from string", () => {
    const { result } = renderHook(
      () => useVal(val.content("foo", () => s.string().fixed("bar"))),
      { wrapper: Providers }
    );
    expect(result.current).toStrictEqual<ValString>({
      val: "bar",
      valId: "foo",
    });
  });

  test("extracts ValString from ValObject", () => {
    const { result } = renderHook(
      () =>
        useVal(
          val.content("baz", () =>
            s.object({ foo: s.string() }).fixed({ foo: "bar" })
          )
        ),
      { wrapper: Providers }
    );
    const vo: ValObject<{ foo: string }> = result.current;
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
