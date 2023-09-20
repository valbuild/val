import { getModuleIds, transform } from "./transform";
import { initVal } from "@valbuild/core";
import { vercelStegaDecode, vercelStegaSplit } from "@vercel/stega";

const { s, val } = initVal();

describe("stega transform", () => {
  test("basic", () => {
    const schema = s.array(
      s.object({
        image: s.image(),
        text: s.richtext(),
        n: s.number(),
        b: s.boolean(),
      })
    );

    const valModule = val.content("/test", schema, [
      {
        image: val.file("/public/test1.png", {
          sha256: "1231",
          width: 100,
          height: 100,
        }),
        text: val.richtext("Test1"),
        n: 1,
        b: true,
      },
      {
        image: val.file("/public/test2.png", {
          sha256: "1232",
          width: 100,
          height: 100,
        }),
        text: val.richtext("Test2"),
        n: 2,
        b: false,
      },
    ]);
    const transformed = transform(valModule, {});

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
          { test: val.content("/test1", schema, ["one", "two"]) },
          { test: val.content("/test2", schema, ["one", "two"]) },
        ],
        test: val.content("/test3", schema, ["one", "two"]),
      })
    ).toStrictEqual(["/test1", "/test2", "/test3"]);
  });

  test("basic transform with get modules", () => {
    const schema = s.array(s.string());
    const transformed = transform(
      val.content("/test1", schema, ["one", "two"]),
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

  test("transform with get modules", () => {
    const schema = s.array(s.string());
    const transformed = transform(
      {
        foo: [
          { test: val.content("/test1", schema, ["one", "two"]) },
          { test: val.content("/test2", schema, ["one", "two"]) },
        ],
        test: val.content("/test3", schema, ["one", "two"]),
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
