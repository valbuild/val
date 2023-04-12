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
  map,
  andThen,
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
  {
    expr: map(fromCtx(0), arrayLiteral([fromCtx(0), fromCtx(1)])),
    str: `.map((v, i) => [v, i])`,
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
  test("simple path yields assignable ref", () => {
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

  test("slice yields associated refs", () => {
    const ctx = [["foo", "bar", "baz"]] as const;
    const rootExpr = fromCtx<typeof ctx, 0>(0);
    const expr = slice(rootExpr, 1);
    expect(expr.evaluateRef(ctx, [""])).toEqual<ValueAndRef<string[]>>([
      ["bar", "baz"],
      ["/1", "/2"],
    ]);
  });

  test("reverse yields associated refs", () => {
    const ctx = [[3, 2, 1]] as const;
    const rootExpr = fromCtx<typeof ctx, 0>(0);
    const expr = reverse(rootExpr);
    expect(expr.evaluateRef(ctx, [""])).toEqual<ValueAndRef<number[]>>([
      [1, 2, 3],
      ["/2", "/1", "/0"],
    ]);
  });

  test("item from reverse yields assignable ref", () => {
    const ctx = [[3, 2, 1]] as const;
    const rootExpr = fromCtx<typeof ctx, 0>(0);
    const expr = item(reverse(rootExpr), 0);
    expect(expr.evaluateRef(ctx, [""])).toEqual<ValueAndRef<number>>([1, "/2"]);
  });

  test("sortBy yields associated refs", () => {
    const ctx = [[3, 2, 1]] as const;
    const rootExpr = fromCtx<typeof ctx, 0>(0);
    const expr = sortBy(rootExpr, fromCtx(0));
    expect(expr.evaluateRef(ctx, [""])).toEqual<ValueAndRef<number[]>>([
      [1, 2, 3],
      ["/2", "/1", "/0"],
    ]);
  });

  test("item from sortBy yields assignable ref", () => {
    const ctx = [[3, 2, 1]] as const;
    const rootExpr = fromCtx<typeof ctx, 0>(0);
    const expr = item(sortBy(rootExpr, fromCtx(0)), 0);
    expect(expr.evaluateRef(ctx, [""])).toEqual<ValueAndRef<number>>([1, "/2"]);
  });
});

describe("evaluation", () => {
  test("fromCtx", () => {
    const input = "foo";
    const expr = fromCtx<[typeof input], 0>(0);
    expect(expr.evaluate([input])).toEqual(input);
    expect(expr.evaluateRef([input], [""])).toEqual([input, ""]);
  });

  test("prop", () => {
    const input = {
      foo: "bar",
    };
    const expr = prop(fromCtx<[typeof input], 0>(0), "foo");
    const expected = input.foo;
    expect(expr.evaluate([input])).toEqual(expected);
    expect(expr.evaluateRef([input], [""])).toEqual([expected, "/foo"]);
  });

  test("item", () => {
    const input = ["foo", "bar"];
    const expr = item(fromCtx<[typeof input], 0>(0), 1);
    const expected = input[1];
    expect(expr.evaluate([input])).toEqual(expected);
    expect(expr.evaluateRef([input], [""])).toEqual([expected, "/1"]);
  });

  test("filter", () => {
    const input = ["foo", null, false, "bar"];
    const expr = filter(fromCtx<[typeof input], 0>(0), fromCtx<[string], 0>(0));
    const expected = input.filter((i) => i);
    expect(expr.evaluate([input])).toEqual(expected);
    expect(expr.evaluateRef([input], [""])).toEqual([expected, ["/0", "/3"]]);
  });

  test("find", () => {
    const input = ["foo", "bar"];
    const expr = find(
      fromCtx<[typeof input], 0>(0),
      eq(fromCtx<[string], 0>(0), "foo")
    );
    const expected = input.find((i) => i === "foo") ?? null;
    expect(expr.evaluate([input])).toEqual(expected);
    expect(expr.evaluateRef([input], [""])).toEqual([expected, "/0"]);
  });

  test("slice", () => {
    const input = ["foo", "bar", "baz"];
    const expr = slice(fromCtx<[typeof input], 0>(0), 1);
    const expected = input.slice(1);
    expect(expr.evaluate([input])).toEqual(expected);
    expect(expr.evaluateRef([input], [""])).toEqual([expected, ["/1", "/2"]]);
  });

  test("sortBy", () => {
    const input = [3, 2, 1];
    const expr = sortBy(fromCtx<[typeof input], 0>(0), fromCtx(0));
    const expected = input.slice().sort((a, b) => a - b);
    expect(expr.evaluate([input])).toEqual(expected);
    expect(expr.evaluateRef([input], [""])).toEqual([
      expected,
      ["/2", "/1", "/0"],
    ]);
  });

  test("reverse", () => {
    const input = ["foo", "bar", "baz"];
    const expr = reverse(fromCtx<[typeof input], 0>(0));
    const expected = input.slice().reverse();
    expect(expr.evaluate([input])).toEqual(expected);
    expect(expr.evaluateRef([input], [""])).toEqual([
      expected,
      ["/2", "/1", "/0"],
    ]);
  });

  test("map", () => {
    const input = [
      {
        prop: "foo",
      },
      {
        prop: "bar",
      },
      {
        prop: "baz",
      },
    ];
    const expr = map(fromCtx<[typeof input], 0>(0), prop(fromCtx(0), "prop"));
    const expected = input.map((v) => v.prop);
    expect(expr.evaluate([input])).toEqual(expected);
    expect(expr.evaluateRef([input], [""])).toEqual([
      expected,
      ["/0/prop", "/1/prop", "/2/prop"],
    ]);
  });

  test("eq", () => {
    const input = "foo";
    const expr = eq(fromCtx<[typeof input], 0>(0), "foo");
    const expected = input === "foo";
    expect(expr.evaluate([input])).toEqual(expected);
    expect(expr.evaluateRef([input], [""])).toEqual([expected, null]);
  });

  test("andThen", () => {
    const input: { prop: string } | null = {
      prop: "foo",
    };
    const expr = andThen(
      fromCtx<[typeof input], 0>(0),
      prop(fromCtx(0), "prop")
    );
    const expected = input?.prop ?? null;
    expect(expr.evaluate([input])).toEqual(expected);
    expect(expr.evaluateRef([input], [""])).toEqual([expected, "/prop"]);
  });

  test("primitiveLiteral", () => {
    const expr = primitiveLiteral<void, 1>(1);
    const expected = 1;
    expect(expr.evaluate()).toEqual(expected);
    expect(expr.evaluateRef()).toEqual([expected, null]);
  });

  test("objectLiteral", () => {
    const input = "foo";
    const expr = objectLiteral<[typeof input], { prop: typeof input }>({
      prop: fromCtx(0),
    });
    const expected = {
      prop: input,
    };
    expect(expr.evaluate([input])).toEqual(expected);
    expect(expr.evaluateRef([input], [""])).toEqual([
      expected,
      {
        prop: "",
      },
    ]);
  });

  test("arrayLiteral", () => {
    const input = "foo";
    const expr = arrayLiteral<[typeof input], [typeof input]>([fromCtx(0)]);
    const expected = [input];
    expect(expr.evaluate([input])).toEqual(expected);
    expect(expr.evaluateRef([input], [""])).toEqual([expected, [""]]);
  });
});
