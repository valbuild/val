/* eslint-disable @typescript-eslint/no-explicit-any */
import { Selector, GenericSelector, SourceOrExpr, Path } from ".";
import { string } from "../schema/string";
import { array } from "../schema/array";
import { SourcePath } from "../val";
import { Source } from "../source";
import { evaluate } from "../expr/eval";
import * as expr from "../expr/expr";
import { result } from "../fp";
import { object } from "../schema/object";
import { newSelectorProxy, selectorToVal } from "./SelectorProxy";
import { newExprSelectorProxy } from "./ExprProxy";
import { remote, RemoteSource } from "../source/remote";

const modules = {
  "/app/text": "text1",
  "/app/texts": ["text1", "text2"] as string[],
  "/app/blog": { title: "blog1", text: "text1" } as {
    title: string | null;
    text: string;
  },
  "/app/blogs": [
    { title: "blog1", text: "text1" },
    { title: undefined, text: "text2" },
  ] as { title: string | null; text: string }[],
  "/app/empty": "",
  "/app/large/nested": BFV(),
};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const remoteModules: {
  [key in keyof TestModules]: RemoteSource<TestModules[key]>;
} = {
  "/app/text": remote("/app/text"),
  "/app/texts": remote("/app/texts"),
  "/app/blog": remote("/app/blog"),
  "/app/blogs": remote("/app/blogs"),
  "/app/empty": remote("/app/empty"),
  "/app/large/nested": remote("/app/large/nested"),
};

const SelectorModuleTestCases: {
  description: string;
  input: (remote: boolean) => GenericSelector<Source>;
  expected: Expected;
}[] = [
  {
    description: "string module lookup",
    input: (remote) => testModule("/app/text", remote),
    expected: {
      val: "text1",
      [Path]: "/app/text",
    },
  },
  {
    description: "basic eq",
    input: (remote) => testModule("/app/text", remote).eq("text1"),
    expected: {
      val: true,
      [Path]: undefined,
    },
  },
  {
    description: "andThen noop",
    input: (remote) => testModule("/app/text", remote).andThen((v) => v),
    expected: {
      val: "text1",
      [Path]: "/app/text",
    },
  },
  {
    description: "array module lookup",
    input: (remote) => testModule("/app/texts", remote),
    expected: {
      val: ["text1", "text2"],
      [Path]: "/app/texts",
    },
  },
  {
    description: "string andThen eq",
    input: (remote) =>
      testModule("/app/text", remote).andThen((v) => v.eq("text1")),
    expected: {
      val: true,
      [Path]: undefined,
    },
  },
  {
    description: "empty string andThen eq",
    input: (remote) =>
      testModule("/app/empty", remote).andThen((v) => v.eq("text1")),
    expected: {
      val: "",
      [Path]: "/app/empty",
    },
  },
  {
    description: "andThen literal eq",
    input: (remote) =>
      testModule("/app/text", remote)
        .andThen(() => "foo")
        .eq("foo"),
    expected: {
      val: true,
      [Path]: undefined,
    },
  },
  {
    description: "andThen undefined literal eq",
    input: (remote) =>
      testModule("/app/text", remote)
        .andThen(() => undefined)
        .eq("foo"),
    expected: {
      val: false,
      [Path]: undefined,
    },
  },
  {
    description: "empty andThen literal eq",
    input: (remote) =>
      testModule("/app/empty", remote)
        .andThen(() => "foo")
        .eq("foo"),
    expected: {
      val: false,
      [Path]: undefined,
    },
  },
  {
    description: "string andThen array literal and index",
    input: (remote) =>
      testModule("/app/text", remote).andThen((v) => [v, "text2"])[0],
    expected: { val: "text1", [Path]: "/app/text" },
  },
  {
    description: "string map undefined -> null literal conversion",
    input: (remote) =>
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      testModule("/app/blogs", remote).map((v) => ({ title: undefined })),
    expected: {
      val: [{ title: null }, { title: null }],
      [Path]: "/app/blogs",
    },
  },
  {
    description: "array map noop",
    input: (remote) => testModule("/app/texts", remote).map((v) => v),
    expected: { val: ["text1", "text2"], [Path]: "/app/texts" },
  },
  {
    description: "array map projection with undefined",
    input: (remote) =>
      testModule("/app/blogs", remote).map((v) => ({
        otherTitle: v.title,
        other: undefined,
      })),
    expected: {
      val: [
        { otherTitle: "blog1", other: null },
        { otherTitle: null, other: null },
      ],
      [Path]: "/app/blogs",
    },
  },
  {
    description: "array index with eq",
    input: (remote) => testModule("/app/texts", remote)[0].eq("text1"),
    expected: { val: true, [Path]: undefined },
  },
  {
    description: "object module lookup",
    input: (remote) => testModule("/app/blog", remote),
    expected: { val: { text: "text1", title: "blog1" }, [Path]: "/app/blog" },
  },
  {
    description: "object andThen property lookup",
    input: (remote) => testModule("/app/blog", remote).andThen((v) => v.title),
    expected: { val: "blog1", [Path]: '/app/blog."title"' },
  },
  {
    description: "array object manipulation: basic indexed obj",
    input: (remote) =>
      testModule("/app/blogs", remote)
        .map((v) => v)[0]
        .title.eq("blog1"),
    expected: {
      val: true,
      [Path]: undefined,
    },
  },
  {
    description: "array object manipulation: filter",
    input: (remote) =>
      testModule("/app/blogs", remote).filter((v) => v.title.eq("blog1")),
    expected: {
      val: [{ text: "text1", title: "blog1" }],
      [Path]: "/app/blogs",
    },
  },
  {
    description: "array object manipulation: map with tuple literal",
    input: (remote) =>
      testModule("/app/blogs", remote).map((a) => [1, a.title]),
    expected: {
      val: [
        [1, "blog1"],
        [1, null],
      ],
      [Path]: "/app/blogs",
    },
  },
  // TODO: tuple literal was reverted
  // {
  //   description: "array object manipulation: map with tuple literal",
  //   input: (remote) =>
  //     testModule("/app/blogs", remote).map((a) => [1, a])[0][1].title,
  //   expected: {
  //     val: "blog1",
  //     [Path]: "/app/blogs.0.title",
  //   },
  // },
  {
    description: "array object manipulation: with literals",
    input: (remote) =>
      testModule("/app/blogs", remote)
        .map((v) => ({
          title: {
            foo: "string",
          },
          subTitle: { bar: v.title },
        }))[0]
        .title.foo.eq("string"),
    expected: { val: true, [Path]: undefined },
  },
  {
    description: "array object manipulation: with literals",
    input: (remote) =>
      testModule("/app/blogs", remote)
        .map((v) => [v.title, v.title])[0][0]
        .eq("blog1"),
    expected: { val: true, [Path]: undefined },
  },
  {
    description: "array object manipulation: with large nested objects",
    input: (remote) =>
      testModule("/app/large/nested", remote).map((v) => ({
        title: {
          foo: "string",
        },
        subTitle: { bar: v },
      }))[0].subTitle.bar.that.even.more.even[0].more.even.more.even.more,
    expected: {
      val: "that.even.more.even.more",
      [Path]:
        '/app/large/nested.0."that"."even"."more"."even".0."more"."even"."more"."even"."more"',
    },
  },
];

const RemoteAndLocaleSelectorModuleTestCases = SelectorModuleTestCases.flatMap(
  (testCase) => [
    {
      input: () => testCase.input(false),
      description: `local ${testCase.description}`,
      expected: testCase.expected,
      remote: false,
    },
    {
      input: () => testCase.input(true),
      description: `remote ${testCase.description}`,
      expected: testCase.expected,
      remote: true,
    },
  ]
);

describe("selector", () => {
  test.each(RemoteAndLocaleSelectorModuleTestCases)(
    "$description",
    ({ input, expected, remote }) => {
      if (input instanceof Error) {
        throw input;
      }
      // TODO: ideally we should be able to evaluate remote and local
      if (!remote) {
        const localeRes = input();
        expect(selectorToVal(localeRes)).toStrictEqual(expected);
      } else {
        const res = evaluate(
          // @ts-expect-error TODO: fix this
          input()[SourceOrExpr],
          (path) => modules[path as keyof typeof modules],
          []
        );
        if (result.isErr(res)) {
          throw res.error;
        }
        expect(selectorToVal(res.value)).toStrictEqual(
          // NOTE: all expected values for REMOTE should be changed to return Vals
          expected
        );
      }
    }
  );
});

type TestModules = typeof modules;

type Expected = any; // TODO: should be Val | Expr

function testModule<P extends keyof TestModules>(
  sourcePath: P,
  remote: boolean
): Selector<TestModules[P]> {
  try {
    if (remote) {
      return newExprSelectorProxy(
        root(sourcePath as SourcePath)
      ) as unknown as Selector<TestModules[P]>;
    }
    return newSelectorProxy(modules[sourcePath], sourcePath as SourcePath);
  } catch (e) {
    // avoid failing all test suite failure on test case creation, instead returns error and throws it inside the test
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return e as any;
  }
}

/** A big schema */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function BFS() {
  return array(
    object({
      title: object({
        foo: object({
          inner: array(
            object({
              innerInnerTitle: object({
                even: object({
                  more: string(),
                }),
              }),
            })
          ),
        }),
      }),
      bar: string(),
      many: array(string()),
      props: string(),
      are: string(),
      here: object({
        even: object({
          more: string(),
        }),
      }),
      for: string(),
      testing: string(),
      purposes: string(),
      and: string(),
      to: string(),
      make: string(),
      sure: string(),
      that: object({
        even: object({
          more: object({
            even: array(
              object({
                more: object({
                  even: object({
                    more: object({
                      even: object({
                        more: string(),
                      }),
                    }),
                  }),
                }),
              })
            ),
          }),
        }),
      }),
      the: string(),
      type: string(),
      system: string(),
      works: string(),
      as: string(),
      expected: string(),
    })
  );
}

/** A big value */
function BFV() {
  return [
    {
      title: {
        foo: {
          inner: [
            {
              innerInnerTitle: {
                even: { more: "inner.innerInnerTitle.even.more" },
              },
            },
          ],
        },
      },
      bar: "bar",
      many: ["many1", "many2", "many3"],
      props: "props",
      are: "are",
      here: { even: { more: "here.even.more" } },
      for: "for",
      testing: "testing",
      purposes: "purposes",
      and: "and",
      to: "to",
      make: "make",
      sure: "sure",
      that: {
        even: {
          more: {
            even: [
              {
                more: {
                  even: {
                    more: { even: { more: "that.even.more.even.more" } },
                  },
                },
              },
            ],
          },
        },
      },
      the: "the",
      type: "type",
      system: "system",
      works: "works",
      as: "as",
      expected: "expected",
    },
  ];
}

function root(sourcePath: string) {
  return new expr.Call(
    [new expr.Sym("val"), new expr.StringLiteral(sourcePath)],
    false
  );
}
