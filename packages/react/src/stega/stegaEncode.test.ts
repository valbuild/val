import { getModuleIds, stegaEncode } from "./stegaEncode";
import { initVal } from "@valbuild/core";
import { vercelStegaDecode, vercelStegaSplit } from "@vercel/stega";

const { s, c } = initVal();

describe("stega transform", () => {
  test("basic", () => {
    const schema = s.array(
      s.object({
        image: s.image(),
        text: s.richtext({}),
        n: s.number(),
        b: s.boolean(),
      })
    );

    const valModule = c.define("/test", schema, [
      {
        image: c.file("/public/test1.png", {
          sha256: "1231",
          width: 100,
          height: 100,
          mimeType: "image/png",
        }),
        text: c.richtext`Test`,
        n: 1,
        b: true,
      },
      {
        image: c.file("/public/test2.png", {
          sha256: "1232",
          width: 100,
          height: 100,
          mimeType: "image/png",
        }),
        text: c.richtext`Test`,
        n: 2,
        b: false,
      },
    ]);
    const transformed = stegaEncode(valModule, {});

    expect(transformed).toHaveLength(2);

    expect(vercelStegaDecode(transformed[0].image.url)).toStrictEqual({
      data: {
        valPath: '/test.0."image"',
      },
      origin: "val.build",
    });
    expect(vercelStegaDecode(transformed[1].image.url)).toStrictEqual({
      data: {
        valPath: '/test.1."image"',
      },
      origin: "val.build",
    });
    //
    expect(vercelStegaSplit(transformed[0].image.url).cleaned).toStrictEqual(
      "/test1.png?sha256=1231"
    );
    expect(vercelStegaSplit(transformed[1].image.url).cleaned).toStrictEqual(
      "/test2.png?sha256=1232"
    );

    expect(transformed[0].text.valPath).toStrictEqual('/test.0."text"');
    expect(transformed[1].text.valPath).toStrictEqual('/test.1."text"');
  });

  test("get modules", () => {
    const schema = s.array(s.string());

    expect(
      getModuleIds({
        foo: [
          { test: c.define("/test1", schema, ["one", "two"]) },
          { test: c.define("/test2", schema, ["one", "two"]) },
        ],
        test: c.define("/test3", schema, ["one", "two"]),
      })
    ).toStrictEqual(["/test1", "/test2", "/test3"]);
  });

  test("basic transform with get modules", () => {
    const schema = s.array(s.string());
    const transformed = stegaEncode(
      c.define("/test1", schema, ["one", "two"]),
      {
        getModule: (moduleId) => {
          if (moduleId === "/test1") {
            return ["1", "2"];
          }
        },
      }
    );

    expect(vercelStegaSplit(transformed[0]).cleaned).toStrictEqual("1");
    expect(vercelStegaDecode(transformed[0])).toStrictEqual({
      data: {
        valPath: "/test1.0",
      },
      origin: "val.build",
    });
  });

  test("Dont stegaEncode raw strings schema", () => {
    const schema = s.object({ str: s.string(), rawStr: s.string().raw() });
    const transformed = stegaEncode(
      c.define("/test1", schema, { str: "one", rawStr: "two" }),
      {}
    );
    //expect(transformed.str).toStrictEqual("one");
    expect(transformed.rawStr).toStrictEqual("two");
  });
  test("transform with get modules", () => {
    const schema = s.array(s.string());
    const transformed = stegaEncode(
      {
        foo: [
          { test: c.define("/test1", schema, ["one", "two"]) },
          { test: c.define("/test2", schema, ["one", "two"]) },
        ],
        test: c.define("/test3", schema, ["one", "two"]),
      },
      {
        getModule: (moduleId) => {
          if (moduleId === "/test2") {
            return ["1", "2"];
          }
        },
      }
    );

    expect(vercelStegaSplit(transformed.foo[0].test[0]).cleaned).toStrictEqual(
      "one"
    );
    expect(vercelStegaDecode(transformed.foo[0].test[0])).toStrictEqual({
      data: {
        valPath: "/test1.0",
      },
      origin: "val.build",
    });

    //

    expect(vercelStegaSplit(transformed.foo[1].test[0]).cleaned).toStrictEqual(
      "1"
    );
    expect(vercelStegaDecode(transformed.foo[1].test[0])).toStrictEqual({
      data: {
        valPath: "/test2.0",
      },
      origin: "val.build",
    });
  });
});
