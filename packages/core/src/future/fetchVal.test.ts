import { initSchema } from "../initSchema";
import { define } from "../module";
import { getValPath } from "../val";
import { serializedValOfSelectorSource, fetchVal } from "./fetchVal";

const s = initSchema();
// const i18n = initI18n(["en_US", "no_NB"]);

describe("serialization of val", () => {
  test("serialized val: string", () => {
    const schema = s.string();

    const testVal = define("/app", schema, "foo");

    expect(serializedValOfSelectorSource(testVal)).toStrictEqual({
      val: "foo",
      valPath: "/app",
    });
  });

  test("serialized val: array", () => {
    const schema = s.array(s.string());

    const testVal = define("/app", schema, ["foo", "bar"]);

    expect(serializedValOfSelectorSource(testVal)).toStrictEqual({
      val: [
        {
          val: "foo",
          valPath: "/app.0",
        },
        { val: "bar", valPath: "/app.1" },
      ],
      valPath: "/app",
    });

    //                          ^?
  });

  test("serialized val: object", () => {
    const schema = s.object({ foo: s.object({ bar: s.array(s.string()) }) });

    const testVal = define("/app", schema, { foo: { bar: ["foo", "bar"] } });

    expect(serializedValOfSelectorSource(testVal)).toStrictEqual({
      val: {
        foo: {
          val: {
            bar: {
              val: [
                {
                  val: "foo",
                  valPath: '/app."foo"."bar".0',
                },
                { val: "bar", valPath: '/app."foo"."bar".1' },
              ],
              valPath: '/app."foo"."bar"',
            },
          },
          valPath: '/app."foo"',
        },
      },
      valPath: "/app",
    });
  });
});

describe("fetchVal", () => {
  test("valuate: string", async () => {
    const schema = s.string();

    const testVal = define("/app", schema, "foo");

    const test = await fetchVal(testVal);
    //     ^? should be Val<string>
    expect(test.val).toBe("foo");
    expect(getValPath(test)).toBe("/app");
  });

  test("valuate: array", async () => {
    const schema = s.array(s.string());

    const testVal = define("/app", schema, ["foo", "bar"]);

    const test = await fetchVal(testVal);
    //      ^? should be Val<string[]>
    expect(test.val).toStrictEqual(["foo", "bar"]);
    expect(test[0].val).toStrictEqual("foo");
    expect(test[1].val).toStrictEqual("bar");
    expect(getValPath(test[0])).toStrictEqual("/app.0");
    expect(getValPath(test[1])).toStrictEqual("/app.1");
  });

  test("valuate: object", async () => {
    const schema = s.object({ foo: s.object({ bar: s.array(s.string()) }) });

    const testVal = define("/app", schema, { foo: { bar: ["foo", "bar"] } });

    const test = await fetchVal(testVal);
    //      ^? should be Val<{ foo: { bar: string[] } }>

    expect(test.val).toStrictEqual({ foo: { bar: ["foo", "bar"] } });
    expect(test.foo.val).toStrictEqual({ bar: ["foo", "bar"] });
    expect(test.foo.bar.val).toStrictEqual(["foo", "bar"]);
    expect(test.foo.bar[0].val).toStrictEqual("foo");
    expect(test.foo.bar[1].val).toStrictEqual("bar");
    expect(getValPath(test.foo.bar[0])).toStrictEqual('/app."foo"."bar".0');
    expect(getValPath(test.foo.bar[1])).toStrictEqual('/app."foo"."bar".1');
  });

  // test("valuate: array with map", async () => {
  //   const schema = s.array(s.string());

  //   const testVal = content("/app", schema, ["foo", "bar"]);

  //   const test = await fetchVal({
  //     //    ^? should be Val<{ title: string }[]>
  //     foo: testVal.map((v) => ({ title: v })),
  //     test: testVal,
  //   });
  //   expect(test.val).toStrictEqual({
  //     foo: [{ title: "foo" }, { title: "bar" }],
  //     test: ["foo", "bar"],
  //   });
  // });

  // test("valuate: 2 modules with oneOf", async () => {
  //   const testVal1 = content("/testVal1", s.array(s.string()), [
  //     "test-val-1-0",
  //     "test-val-1-1",
  //   ]);
  //   const testVal2 = content(
  //     "/testVal2",
  //     s.object({ test1: s.oneOf(testVal1), test2: s.string() }),
  //     {
  //       test2: "test2 value",
  //       test1: testVal1[0],
  //     }
  //   );

  //   const test = await fetchVal({
  //     //    ^?
  //     testVal1: testVal1.map((v) => ({ title: v, otherModule: testVal2 })),
  //     testVal2: testVal2,
  //   });
  //   expect(test.val).toStrictEqual({
  //     testVal1: [
  //       {
  //         title: "test-val-1-0",
  //         otherModule: { test2: "test2 value", test1: "test-val-1-0" },
  //       },
  //       {
  //         title: "test-val-1-1",
  //         otherModule: { test2: "test2 value", test1: "test-val-1-0" },
  //       },
  //     ],
  //     testVal2: { test2: "test2 value", test1: "test-val-1-0" },
  //   });
  //   expect(getValPath(test.testVal1[0].otherModule.test1)).toStrictEqual(
  //     "/testVal1.0"
  //   );
  //   expect(getValPath(test.testVal2.test2)).toStrictEqual('/testVal2."test2"');
  // });
});
