import { addValPathIfFound } from "./autoTagJSX";
import { stegaEncode } from "./stegaEncode";
import { initVal } from "@valbuild/core";
const { s, c } = initVal();

describe("autoTag", () => {
  it("in", () => {
    const schema = s.object({
      url: s.string(),
      text: s.string(),
    });
    const valModule = c.define("/test", schema, {
      url: "https://val.build",
      text: "Test",
    });
    const selector = stegaEncode(valModule, {});
    const props: Record<string, unknown> = {
      href: selector.url,
      children: selector.text,
    };
    addValPathIfFound(
      {
        $$typeof: Symbol("react.forward_ref"),
      },
      props
    );
    expect(props.children).toStrictEqual("Test");
    expect(props.href).toStrictEqual("https://val.build");
    expect(props["data-val-path"]).toStrictEqual(
      '/test?p="url",/test?p="text"'
    );
  });

  it("forward refs should clean children", () => {
    const schema = s.object({
      url: s.string(),
      text: s.string(),
    });
    const valModule = c.define("/test", schema, {
      url: "https://val.build",
      text: "Test",
    });
    const selector = stegaEncode(valModule, {});
    const props: Record<string, unknown> = {
      href: selector.url,
      children: selector.text,
    };
    addValPathIfFound(
      {
        $$typeof: Symbol("react.forward_ref"),
      },
      props
    );
    expect(props.children).toStrictEqual("Test");
    expect(props.href).toStrictEqual("https://val.build");
    expect(props["data-val-path"]).toStrictEqual(
      '/test?p="url",/test?p="text"'
    );
  });
});
