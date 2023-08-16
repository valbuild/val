import { pipe, result } from "../fp";
import { Path } from "../selector";
import { selectorToVal } from "../selector/SelectorProxy";
import { Source } from "../source";
import { evaluate } from "./eval";
import { parse } from "./parser";

const sources = {
  "/app/text": "text1",
  "/numbers": [0, 1, 2],
  "/articles": [{ title: "title1" }, { title: "title2" }],
  "/app/blogs": [
    { title: "blog1", text: "text1" },
    { title: "blog2", text: "text2" },
  ],
};

const EvalTestCases: {
  expr: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expected: result.Result<{ val: Source; [Path]: any }, any>;
  focus?: boolean; // use focus to specify a single test case
}[] = [
  {
    expr: `'hello world'`,
    expected: result.ok({ val: "hello world", [Path]: undefined }),
  },
  {
    expr: `(val '/numbers')`,
    expected: result.ok({ val: [0, 1, 2], [Path]: "/numbers" }),
  },
  {
    expr: `('hello world')`,
    expected: result.ok({ val: "hello world", [Path]: undefined }),
  },
  {
    expr: `()`,
    expected: result.ok({ val: null, [Path]: undefined }),
  },
  {
    expr: `(eq 'value' 'show me')`,
    expected: result.ok({ val: false, [Path]: undefined }),
  },
  {
    expr: `(eq 'value' 'value')`,
    expected: result.ok({ val: true, [Path]: undefined }),
  },
  {
    expr: `!(andThen 'value' 'show me')`,
    expected: result.ok({ val: "show me", [Path]: undefined }),
  },
  {
    expr: `!(andThen '' ('do NOT show me'))`,
    expected: result.ok({ val: "", [Path]: undefined }),
  },
  {
    expr: `!(andThen 'text1' @[0,0])`,
    expected: result.ok({ val: "text1", [Path]: undefined }),
  },
  {
    expr: `(json '1')`,
    expected: result.ok({ val: 1, [Path]: undefined }),
  },
  {
    expr: `(json '"1"')`,
    expected: result.ok({ val: "1", [Path]: undefined }),
  },
  {
    expr: `(json '{"foo": "bar"}')`,
    expected: result.ok({ val: { foo: "bar" }, [Path]: undefined }),
  },
  {
    expr: `(json '\${(json '1')}')`,
    expected: result.ok({ val: 1, [Path]: undefined }),
  },
  {
    expr: `(json '\${(json '"1"')}')`,
    expected: result.ok({ val: "1", [Path]: undefined }),
  },
  {
    expr: `(json '{"foo": \${(json '"1"')}}')`,
    expected: result.ok({
      val: {
        foo: "1",
      },
      [Path]: undefined,
    }),
  },
  {
    expr: `(json '\${(val '/numbers')}')`,
    expected: result.ok({
      val: sources["/numbers"],
      [Path]: "/numbers",
    }),
  },
  {
    expr: `('test' (json '{ "test": \${((json '0') (val '/numbers'))} }'))`,
    expected: result.ok({
      val: 0,
      [Path]: "/numbers.0",
    }),
  },
  {
    expr: `((json '1') ('foo' (json '{"foo": \${(val '/numbers')}}')))`,
    expected: result.ok({ val: 1, [Path]: "/numbers.1" }),
  },
  {
    expr: `(length (val '/numbers'))`,
    expected: result.ok({
      val: sources["/numbers"].length,
      [Path]: undefined,
    }),
  },
  {
    expr: `('0' (val '/articles'))`,
    expected: result.ok({
      val: sources["/articles"][0],
      [Path]: "/articles.0",
    }),
  },
  {
    expr: `!(map (val '/articles') @[0,0])`,
    expected: result.ok({
      val: sources["/articles"].map((v) => v),
      [Path]: "/articles",
    }),
  },
  {
    expr: `('0' !(map (val '/articles') ('title' @[0,0])))`,
    expected: result.ok({
      val: sources["/articles"].map((v) => v["title"])[0],
      [Path]: '/articles.0."title"',
    }),
  },
  {
    expr: `!(map (val '/articles') ('title' @[0,0]))`,
    expected: result.ok({
      val: sources["/articles"].map((v) => v["title"]),
      [Path]: "/articles",
    }),
  },
  {
    expr: `(eq !(andThen (val '/app/text') ()) 'foo')`,
    expected: result.ok({
      val: false,
      [Path]: undefined,
    }),
  },
  {
    expr: `!(filter (val '/app/blogs') (eq ('title' @[0,0]) 'blog1'))`,
    expected: result.ok({
      val: [
        {
          text: "text1",
          title: "blog1",
        },
      ],
      [Path]: "/app/blogs",
    }),
  },
  {
    expr: `(json '{"title": \${()}}')`,
    expected: result.ok({
      val: {
        title: null,
      },

      [Path]: undefined,
    }),
  },
];

describe("eval", () => {
  test.each(
    EvalTestCases.filter(({ focus }) =>
      EvalTestCases.some((v) => v.focus) ? focus : true
    )
  )('evaluate: "$expr"', ({ expr, expected }) => {
    const parseRes = parse(expr);
    if (result.isErr(parseRes)) {
      return expect(parseRes).toHaveProperty("value");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(
      pipe(
        evaluate(
          parseRes.value,
          (path) => {
            return sources[path as keyof typeof sources];
          },
          []
        ),
        result.map((v) => selectorToVal(v))
      )
    ).toStrictEqual(expected);
  });
  //
});
