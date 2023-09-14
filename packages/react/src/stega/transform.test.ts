import { transform } from "./transform";
import { initVal } from "@valbuild/core";
import { vercelStegaDecode, vercelStegaSplit } from "@vercel/stega";

describe("stega transform", () => {
  test("basic", () => {
    const { s, val } = initVal();

    const schema = s.array(
      s.object({
        image: s.image(),
        text: s.richtext(),
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
      },
      {
        image: val.file("/public/test2.png", {
          sha256: "1232",
          width: 100,
          height: 100,
        }),
        text: val.richtext("Test2"),
      },
    ]);
    const transformed = transform(valModule);

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
});
