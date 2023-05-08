import { pipe, result } from "../../fp";
import { newSelectorProxy, selectorToVal } from "../selector/SelectorProxy";
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
    expected: result.ok({ val: [0, 1, 2], valPath: "/numbers" }),
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
    expr: `!(andThen 'value' 'show me')`,
    expected: result.ok({ val: "show me", valPath: undefined }),
  },
  {
    expr: `!(andThen '' ('do NOT show me'))`,
    expected: result.ok({ val: "", valPath: undefined }),
  },
  {
    expr: `!(andThen 'text1' @[0,0])`,
    expected: result.ok({ val: "text1", valPath: undefined }),
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
    expr: `(json '\${(json '1')}')`,
    expected: result.ok({ val: 1, valPath: undefined }),
  },
  {
    expr: `(json '\${(json '"1"')}')`,
    expected: result.ok({ val: "1", valPath: undefined }),
  },
  {
    expr: `(json '{"foo": \${(json '"1"')}}')`,
    expected: result.ok({
      val: {
        foo: {
          // NOTE: <- this is an artifact since everything is selectable (we do not know if the inside of a literal is a val or just a literal)
          val: "1",
        },
      },
      valPath: undefined,
    }),
  },
  {
    expr: `(json '\${(val '/numbers')}')`,
    expected: result.ok({
      val: sources["/numbers"],
      valPath: "/numbers",
    }),
  },
  {
    expr: `('test' (json '{ "test": \${('0' (val '/numbers'))} }'))`,
    expected: result.ok({
      val: 0,
      valPath: "/numbers.0",
    }),
  },
  {
    expr: `('1' ('foo' (json '{"foo": \${(val '/numbers')}}')))`,
    expected: result.ok({ val: 1, valPath: "/numbers.1" }),
  },
  {
    expr: `(length (val '/numbers'))`,
    expected: result.ok({
      val: sources["/numbers"].length,
      valPath: undefined,
    }),
  },
  // TODO: implement slice, reverse
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
  {
    expr: `!(map (val '/articles') @[0,0])`,
    expected: result.ok({
      val: sources["/articles"].map((v) => v),
      valPath: "/articles",
    }),
  },
  {
    expr: `('0' !(map (val '/articles') ('title' @[0,0])))`,
    expected: result.ok({
      val: sources["/articles"].map((v) => v["title"])[0],
      valPath: "/articles.0.title",
    }),
  },
  {
    expr: `!(map (val '/articles') ('title' @[0,0]))`,
    expected: result.ok({
      val: sources["/articles"].map((v) => v["title"]),
      valPath: "/articles",
    }),
  },
  // TODO: implement slice
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
        result.map((v) => selectorToVal(v))
      )
    ).toStrictEqual(expected);
  });
  //
});
