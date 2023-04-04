import { useVal } from "./useVal";
import { CompositeVal, initVal, PrimitiveVal } from "@valbuild/lib";
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
    const mod = val.content("foo", s.string(), "bar");
    const { result } = renderHook(() => useVal(mod, "en_US"), {
      wrapper: Providers,
    });
    expect(result.current).toStrictEqual<PrimitiveVal<string>>({
      val: "bar",
      valSrc: "foo?en_US?",
    });
  });

  test("extracts ValString from ValObject", () => {
    const mod = val.content("baz", s.object({ foo: s.string() }), {
      foo: "bar",
    });

    const { result } = renderHook(() => useVal(mod, "en_US"), {
      wrapper: Providers,
    });
    const vo: CompositeVal<{ foo: string }> = result.current;
    expect(vo.foo).toStrictEqual<PrimitiveVal<string>>({
      valSrc: `baz?en_US?."foo"`,
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
