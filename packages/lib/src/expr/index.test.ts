import { parse, Expr, prop, sortBy, fromCtx, filter, find } from ".";

const serializationTestCases: {
  str: string;
  expr: Expr<readonly [never], unknown>;
}[] = [
  {
    str: `["prop"]`,
    expr: prop(fromCtx<0, never>(0), "prop"),
  },
  {
    str: `[0]`,
    expr: prop(fromCtx<0, never>(0), 0),
  },
  {
    str: `["foo"]["bar"]`,
    expr: prop(prop(fromCtx<0, never>(0), "foo"), "bar"),
  },
  {
    str: `.sortBy((v) => v)`,
    expr: sortBy(fromCtx<0, never>(0), fromCtx<0, never>(0)),
  },
  {
    str: `.filter((v) => v)`,
    expr: filter(fromCtx<0, never>(0), fromCtx<0, never>(0)),
  },
  {
    str: `.find((v) => v)`,
    expr: find(fromCtx<0, never>(0), fromCtx<0, never>(0)),
  },
  {
    str: `["foo"].find((v) => v["bar"])`,
    expr: find(
      prop(fromCtx<0, never>(0), "foo"),
      prop(fromCtx<0, never>(0), "bar")
    ),
  },
];

test.each(serializationTestCases)("parse $str", ({ str, expr }) => {
  const result = parse<readonly [never]>({ "": 0 }, str);
  expect(result).toEqual(expr);
});

test.each(serializationTestCases)("toString $str", ({ str, expr }) => {
  const result = expr.toString([""]);
  expect(result).toEqual(str);
});
