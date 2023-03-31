import {
  parse,
  Expr,
  prop,
  sortBy,
  fromCtx,
  filter,
  find,
  ValueAndRef,
  slice,
  item,
  eq,
  reverse,
  primitiveLiteral,
  objectLiteral,
  arrayLiteral,
} from "./expr";

const serializationTestCases: {
  expr: Expr<readonly [never], unknown>;
  str: string;
}[] = [
  {
    expr: prop(fromCtx(0), "prop"),
    str: `."prop"`,
  },
  {
    expr: prop(fromCtx(0), `pr"op`),
    str: `."pr\\"op"`,
  },
  {
    expr: item(fromCtx(0), -0),
    str: `.0`,
  },
  {
    expr: item(fromCtx(0), 0),
    str: `.0`,
  },
  {
    expr: item(fromCtx(0), 187),
    str: `.187`,
  },
  {
    expr: prop(prop(fromCtx(0), "foo"), "bar"),
    str: `."foo"."bar"`,
  },
  {
    expr: eq(fromCtx(0), "foo"),
    str: `.eq("foo")`,
  },
  {
    expr: sortBy(fromCtx(0), fromCtx<never, 0>(0)),
    str: `.sortBy((v) => v)`,
  },
  {
    expr: reverse(fromCtx(0)),
    str: `.reverse()`,
  },
  {
    expr: filter(fromCtx(0), fromCtx(0)),
    str: `.filter((v) => v)`,
  },
  {
    expr: find(fromCtx(0), fromCtx(0)),
    str: `.find((v) => v)`,
  },
  {
    expr: find(prop(fromCtx(0), "foo"), prop(fromCtx<never, 0>(0), "bar")),
    str: `."foo".find((v) => v."bar")`,
  },
  {
    expr: primitiveLiteral(1.23),
    str: `<1.23>`,
  },
  {
    expr: primitiveLiteral(true),
    str: `<true>`,
  },
  {
    expr: primitiveLiteral(null),
    str: `<null>`,
  },
  {
    expr: primitiveLiteral("null"),
    str: `"null"`,
  },
  {
    expr: objectLiteral({
      foo: prop(fromCtx(0), "foo"),
      bar: prop(fromCtx(0), "baz"),
    }),
    str: `{"foo": ."foo", "bar": ."baz"}`,
  },
  {
    expr: objectLiteral({ foo: fromCtx(0), bar: fromCtx(0) }),
    str: `{"foo": , "bar": }`,
  },
  {
    expr: arrayLiteral([]),
    str: `[]`,
  },
  {
    expr: objectLiteral({}),
    str: `{}`,
  },
  {
    expr: arrayLiteral([primitiveLiteral(1), primitiveLiteral(2)]),
    str: `[<1>, <2>]`,
  },
  {
    expr: item(arrayLiteral([primitiveLiteral(1), primitiveLiteral(2)]), 0),
    str: `[<1>, <2>].0`,
  },
  {
    // @ts-expect-error does not type-check, but runtime should work
    expr: prop(arrayLiteral([primitiveLiteral(1), primitiveLiteral(2)]), "0"),
    str: `[<1>, <2>]."0"`,
  },
  {
    expr: arrayLiteral([primitiveLiteral("1"), primitiveLiteral(2)]),
    str: `["1", <2>]`,
  },
  {
    expr: arrayLiteral([
      objectLiteral({ foo: primitiveLiteral("bar") }),
      primitiveLiteral(2),
    ]),
    str: `[{"foo": "bar"}, <2>]`,
  },
  {
    expr: arrayLiteral([
      arrayLiteral([primitiveLiteral(1)]),
      primitiveLiteral(2),
    ]),
    str: `[[<1>], <2>]`,
  },
];

test.each(serializationTestCases)("parse $str", ({ str, expr }) => {
  const result = parse<never>({ "": 0 }, str);
  expect(result).toEqual(expr);
});

test.each(serializationTestCases)("toString $str", ({ str, expr }) => {
  const result = expr.toString([""]);
  expect(result).toEqual(str);
});

describe("evaluateRef", () => {
  test("simple path yields singular path", () => {
    const ctx = [
      {
        foo: {
          bar: "baz",
        },
      },
    ] as const;
    const rootExpr = fromCtx<typeof ctx, 0>(0);
    const expr = prop(prop(rootExpr, "foo"), "bar");
    expect(expr.evaluateRef(ctx, [""])).toEqual<ValueAndRef<"baz">>([
      "baz",
      "/foo/bar",
    ]);
  });

  test("slice yields multiple paths", () => {
    const ctx = [["foo", "bar", "baz"]] as const;
    const rootExpr = fromCtx<typeof ctx, 0>(0);
    const expr = slice(rootExpr, 1);
    expect(expr.evaluateRef(ctx, [""])).toEqual<ValueAndRef<string[]>>([
      ["bar", "baz"],
      ["/1", "/2"],
    ]);
  });

  test("reverse yields multiple paths", () => {
    const ctx = [[3, 2, 1]] as const;
    const rootExpr = fromCtx<typeof ctx, 0>(0);
    const expr = reverse(rootExpr);
    expect(expr.evaluateRef(ctx, [""])).toEqual<ValueAndRef<number[]>>([
      [1, 2, 3],
      ["/2", "/1", "/0"],
    ]);
  });

  test("reverse item yields singular path", () => {
    const ctx = [[3, 2, 1]] as const;
    const rootExpr = fromCtx<typeof ctx, 0>(0);
    const expr = item(reverse(rootExpr), 0);
    expect(expr.evaluateRef(ctx, [""])).toEqual<ValueAndRef<number>>([1, "/2"]);
  });

  test("sortBy yields multiple paths", () => {
    const ctx = [[3, 2, 1]] as const;
    const rootExpr = fromCtx<typeof ctx, 0>(0);
    const expr = sortBy(rootExpr, fromCtx(0));
    expect(expr.evaluateRef(ctx, [""])).toEqual<ValueAndRef<number[]>>([
      [1, 2, 3],
      ["/2", "/1", "/0"],
    ]);
  });

  test("sortBy item yields singular path", () => {
    const ctx = [[3, 2, 1]] as const;
    const rootExpr = fromCtx<typeof ctx, 0>(0);
    const expr = item(sortBy(rootExpr, fromCtx(0)), 0);
    expect(expr.evaluateRef(ctx, [""])).toEqual<ValueAndRef<number>>([1, "/2"]);
  });
});
