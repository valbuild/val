/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  AsVal,
  Selector,
  SelectorC,
  SelectorOf,
  SelectorSource,
  VAL_OR_EXPR,
} from ".";
import { string } from "../schema/string";
import { array } from "../schema/array";
import { createSelector } from "./create";
import { SourcePath, Val } from "../val";
import { RemoteSource, Source } from "../Source";
import { evaluate } from "../expr/eval";
import * as expr from "../expr/expr";
import { result } from "../../fp";
import { Schema } from "../schema";
import { object } from "../schema/object";

const modules = {
  "/app/text": "text1",
  "/app/texts": ["text1", "text2"],
  "/app/blog": { title: "blog1", text: "text1" },
  "/app/blogs": [
    { title: "blog1", text: "text1" },
    { title: "blog2", text: "text2" },
  ],
  "/app/empty": "",
  "/app/large/nested": BFV(),
};
const remoteModules: {
  [key in keyof TestModules]: RemoteSource<TestModules[key]>;
} = {
  "/app/text": remoteSource("/app/text", string()),
  "/app/texts": remoteSource("/app/texts", array(string())),
  "/app/blog": remoteSource("/app/blog", object({ title: string() })),
  "/app/blogs": remoteSource("/app/blogs", array(object({ title: string() }))),
  "/app/empty": remoteSource("/app/empty", string()),
  "/app/large/nested": remoteSource("/app/large/nested", BFS()),
};

const SelectorModuleTestCases: {
  description: string;
  input: (remote: boolean) => Selector<Source>;
  expected: Expected;
}[] = [
  {
    description: "string module lookup",
    input: (remote) => testModule("/app/text", remote),
    expected: {
      val: "text1",
      valPath: "/app/text",
    },
  },
  {
    description: "basic eq",
    input: (remote) => testModule("/app/text", remote).eq("text1"),
    expected: {
      val: true,
      valPath: undefined,
    },
  },
  {
    description: "andThen noop",
    input: (remote) => testModule("/app/text", remote).andThen((v) => v),
    expected: {
      val: "text1",
      valPath: "/app/text",
    },
  },
  {
    description: "array module lookup (TODO)",
    input: (remote) => testModule("/app/texts", remote),
    expected: [
      { val: "text1", valPath: "/app/texts.0" },
      { val: "text2", valPath: "/app/texts.1" },
    ],
  },
  {
    description: "string andThen eq",
    input: (remote) =>
      testModule("/app/text", remote).andThen((v) => v.eq("text1")),
    expected: {
      val: true,
      valPath: undefined,
    },
  },
  {
    description: "empty string andThen eq",
    input: (remote) =>
      testModule("/app/empty", remote).andThen((v) => v.eq("text1")),
    expected: {
      val: "",
      valPath: "/app/empty",
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
      valPath: undefined,
    },
  },
  {
    description: "andThen undefined literal eq (TODO)",
    input: (remote) =>
      testModule("/app/text", remote)
        .andThen(() => undefined)
        .eq("foo"),
    expected: {
      val: false,
      valPath: undefined,
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
      valPath: undefined,
    },
  },
  {
    description: "string andThen array literal (TODO)",
    input: (remote) =>
      testModule("/app/text", remote).andThen((v) => [v, "text2"]),
    expected: [
      { val: "text1", valPath: "/app/text" },
      { val: "text2", valPath: undefined },
    ],
  },
  {
    description: "string map undefined literal (TODO)",
    input: (remote) =>
      testModule("/app/blogs", remote).map((v) => ({ title: undefined })),
    expected: "todo",
  },
  {
    description: "string map nested undefined literal (TODO)",
    input: (remote) =>
      testModule("/app/blogs", remote).map((v) => ({
        title: { bar: undefined },
      })),
    expected: "todo",
  },
  {
    description: "array map noop (TODO)",
    input: (remote) => testModule("/app/texts", remote).map((v) => v),
    expected: [
      { val: "text1", valPath: "/app/text" },
      { val: "text2", valPath: undefined },
    ],
  },
  {
    description: "array map projection (TODO)",
    input: (remote) =>
      testModule("/app/blogs", remote).map((v) => ({ otherTitle: v.title })),
    expected: "todo",
  },
  {
    description: "array index with eq (TODO)",
    input: (remote) => testModule("/app/texts", remote)[0].eq("text1"),
    expected: { val: "text1", valPath: "/app/text" },
  },
  {
    description: "array index with eq (TODO)",
    input: (remote) => testModule("/app/texts", remote)[0].eq("text1"),
    expected: { val: "text1", valPath: "/app/text" },
  },
  {
    description: "object module lookup (TODO)",
    input: (remote) => testModule("/app/blog", remote),
    expected: "todo",
  },
  {
    description: "object andThen property lookup (TODO)",
    input: (remote) => testModule("/app/blog", remote).andThen((v) => v.title),
    expected: "todo",
  },
  {
    description: "object andThen property lookup (TODO)",
    input: (remote) => testModule("/app/blog", remote).andThen((v) => v.title),
    expected: "todo",
  },
  {
    description: "array object module lookup (TODO)",
    input: (remote) => testModule("/app/blogs", remote),
    expected: [
      { title: { val: "blog1", valPath: "/app/blogs.0.title" } },
      { title: { val: "blog2", valPath: "/app/blogs.1.title" } },
    ],
  },
  {
    description: "array property lookup (TODO)",
    input: (remote) => testModule("/app/blogs", remote)[0],
    expected: "todo",
  },
  {
    description: "array object index lookup (TODO)",
    input: (remote) => testModule("/app/blogs", remote)[0],
    expected: "todo",
  },
  {
    description: "array object manipulation: basic (TODO)",
    input: (remote) =>
      testModule("/app/blogs", remote)
        .map((v) => v)[0]
        .andThen((v) => v.title)
        .eq(""),
    expected: "todo",
  },
  {
    description: "array object manipulation: basic indexed obj (TODO)",
    input: (remote) =>
      testModule("/app/blogs", remote)
        .map((v) => v)[0]
        .title.eq("title1"),
    expected: "todo",
  },
  {
    description: "array object manipulation: filter (TODO)",
    input: (remote) =>
      testModule("/app/blogs", remote).filter((v) => v.title.eq("blog1")),
    expected: "todo",
  },
  {
    description: "array object manipulation: with literals (TODO)",
    input: (remote) =>
      testModule("/app/blogs", remote)
        .map((v) => ({
          title: {
            foo: "string",
          },
          subTitle: { bar: v.title },
        }))[0]
        .title.foo.eq("fdso"),
    expected: "todo",
  },
  {
    description: "array object manipulation: with literals (TODO)",
    input: (remote) =>
      testModule("/app/blogs", remote)
        .map((v) => [v.title, v.title])[0][0]
        .eq("title1"),
    expected: "todo",
  },
  {
    description: "array object manipulation: with large nested objects (TODO)",
    input: (remote) =>
      testModule("/app/large/nested", remote)
        .map((v) => ({
          title: {
            foo: "string",
          },
          subTitle: { bar: v },
        }))[0]
        .subTitle.bar.that.even.more.even[0].more.even.more.even.more.eq(""),
    expected: "todo",
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
        const localeRes = (input() as unknown as AsVal<Source>)[VAL_OR_EXPR]();
        expect(localeRes).toStrictEqual(expected);
      } else {
        const remoteRes = (input() as unknown as AsVal<Source>)[VAL_OR_EXPR]();
        if (remoteRes instanceof expr.Expr) {
          expect(
            evaluate(
              remoteRes,
              (ref) => modules[ref as keyof typeof modules],
              []
            )
          ).toStrictEqual(
            result.ok(
              // NOTE: all expected values for REMOTE should be changed to return Vals
              expected.val
            )
          );
        } else {
          expect(remoteRes).toStrictEqual(expect.any(expr.Expr));
        }
      }
    }
  );
});
type TestModules = typeof modules;

type Expected = any; // TODO: should be Val | Expr

function testModule<P extends keyof TestModules>(
  sourcePath: P,
  remote: boolean
): SelectorOf<TestModules[P]> {
  try {
    return createSelector(
      remote ? remoteModules[sourcePath] : modules[sourcePath],
      sourcePath as SourcePath
    );
  } catch (e) {
    // avoid failing all test suite failure on test case creation, instead returns error and throws it inside the test
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return e as any;
  }
}

function remoteSource<P extends keyof TestModules>(
  ref: P,
  schema: Schema<TestModules[P]>
): RemoteSource<TestModules[P]> {
  return {
    _ref: ref,
    _type: "remote",
    _schema: schema,
  } as RemoteSource<TestModules[P]>;
}

/** A big schema */
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
