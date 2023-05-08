import { pipe, result } from "../../fp";
import { VAL_OR_EXPR } from "../selector";
import { newSelectorProxy } from "../selector/SelectorProxy";
import { SourcePath } from "../val";
import { evaluate } from "./eval";
import { parse } from "./parser";

const sources = {
  "/numbers": [0, 1, 2],
  "/articles": [{ title: "title1" }, { title: "title2" }],
};

const EvalTestCases = [
  {
    expr: `'hello world'`,
    expected: result.ok({ val: "hello world", valPath: undefined }),
  },
  {
    expr: `(val '/numbers')`,
    expected: result.ok({ valPath: "/numbers", val: [0, 1, 2] }),
  },
  {
    expr: `('hello world')`,
    expected: result.ok({ val: "hello world", valPath: undefined }),
  },
  {
    expr: `()`,
    expected: result.ok({ val: undefined, valPath: undefined }),
  },
  {
    expr: `(eq 'value' 'show me')`,
    expected: result.ok({ val: false, valPath: undefined }),
  },
  {
    expr: `(eq 'value' 'value')`,
    expected: result.ok({ val: true, valPath: undefined }),
  },
  {
    expr: `(json '1')`,
    expected: result.ok({ val: 1, valPath: undefined }),
  },
  {
    expr: `(json '"1"')`,
    expected: result.ok({ val: "1", valPath: undefined }),
  },
  {
    expr: `(json '{"foo": "bar"}')`,
    expected: result.ok({ val: { foo: "bar" }, valPath: undefined }),
  },
  {
    expr: `(stringify '1')`,
    expected: result.ok({ val: '"1"', valPath: undefined }),
  },
  {
    expr: `(stringify (json '1'))`,
    expected: result.ok({ val: "1", valPath: undefined }),
  },
  {
    expr: `(stringify (json '"1"'))`,
    expected: result.ok({ val: '"1"', valPath: undefined }),
  },
  {
    expr: `'{"foo": \${(stringify (json '"1"'))}}'`,
    expected: result.ok({ val: '{"foo": "1"}', valPath: undefined }),
  },
  // TODO: local val module inside expressions:
  // {
  //   expr: `'{"foo": \${(stringify (val '/numbers'))}}'`,
  //   expected: result.ok({ val: '{"foo": [1, 2, 3]}', valPath: undefined }),
  // },
  // {
  //   expr: `('0' (json '{"foo": \${(stringify (val '/numbers'))}}'))`,
  //   expected: result.ok({ val: 1, valPath: "/numbers/0" }),
  // },
  // {
  //   expr: `'{"foo": \${(stringify (length (val '/numbers')))}}'`,
  //   expected: result.ok({ val: '{"foo": 3}', valPath: undefined }),
  // },
  {
    expr: `(json '{"foo": \${(stringify '"')}}')`,
    expected: result.ok({ val: { foo: '"' }, valPath: undefined }),
  },
  {
    expr: `!(andThen 'value' 'show me')`,
    expected: result.ok({ val: "show me", valPath: undefined }),
  },
  {
    expr: `!(andThen 'text1' @[0,0])`,
    expected: result.ok({ val: "text1", valPath: undefined }),
  },
  {
    expr: `!(andThen '' ('do NOT show me'))`,
    expected: result.ok({ val: "", valPath: undefined }),
  },
  {
    // TODO: should we do ('numbers' val) to be more consistent?
    expr: `(length (val '/numbers'))`,
    expected: result.ok({
      val: sources["/numbers"].length,
      valPath: undefined,
    }),
  },
  // TODO: implement
  // {
  //   expr: `(slice (val '/numbers') 0 2)`,
  //   expected: result.ok(sources["/numbers"].slice(0, 2)),
  // },
  // {
  //   expr: `(reverse (val '/numbers') ())`,
  //   expected: result.ok(sources["/numbers"].slice().reverse()), // reverse is mutable so slice / copy before reverse
  // },
  {
    expr: `('0' (val '/articles'))`,
    expected: result.ok({
      val: sources["/articles"][0],
      valPath: "/articles.0",
    }),
  },
  // TODO: fix interpolations inside expressions
  // {
  //   expr: `'\${('0' (val '/articles'))}'`,
  //   expected: result.ok(`${sources["/articles"][0]}`),
  // },
  {
    expr: `!(map (val '/articles') @[0,0])`,
    expected: result.ok({
      val: sources["/articles"].map((v) => v),
      valPath: "/articles",
    }),
  },
  {
    expr: `('0' !(map (val '/articles') ('title' @[0,0])))`,
    expected: result.ok(sources["/articles"].map((v) => v["title"])),
  },
  // // {
  // //   expr: `!(map (val '/numbers') !(andThen @[0,0] @[1,0]))`,
  // //   expected: result.ok(sources["/articles"].map((v) => v["title"])),
  // // },
  // {
  //   expr: `!(map (val '/articles')
  //                (slice ('title' @[0,0])
  //                       0
  //                       2))`,
  //   expected: result.ok(
  //     sources["/articles"].map((v) => v["title"].slice(0, 2))
  //   ),
  // },
  // {
  //   expr: `!(map (val '/articles')
  //                !(map (val '/numbers')
  //                      (slice ('title' @[0,0])
  //                             0
  //                             @[1,1])))`,
  //   expected: result.ok(
  //     sources["/articles"].map((v) =>
  //       sources["/numbers"].map((_, i) => v["title"].slice(0, i))
  //     )
  //   ),
  // },
];

describe("eval", () => {
  test.each(EvalTestCases)('evaluate: "$expr"', ({ expr, expected }) => {
    const parseRes = parse(expr);
    if (result.isErr(parseRes)) {
      return expect(parseRes).toHaveProperty("value");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(
      pipe(
        evaluate(
          parseRes.value,
          (ref) =>
            newSelectorProxy(
              sources[ref as keyof typeof sources],
              ref as SourcePath
            ),

          []
        ),
        result.map((v) => v[VAL_OR_EXPR]())
      )
    ).toStrictEqual(expected);
  });
  //
});
