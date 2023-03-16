import {
  fromString,
  Expr,
  prop,
  mod,
  ModContext,
  MOD,
  sortBy,
  fromCtx,
} from ".";

const serializationTestCases: {
  str: string;
  expr: Expr<ModContext<"">, unknown>;
}[] = [
  {
    str: `["prop"]`,
    expr: prop(mod, "prop"),
  },
  {
    str: `[0]`,
    expr: prop(mod, 0),
  },
  {
    str: `["foo"]["bar"]`,
    expr: prop(prop(mod, "foo"), "bar"),
  },
  {
    str: `.sortBy((v) => v)`,
    expr: (() => {
      const vSym = Symbol("v");
      return sortBy(mod, vSym, fromCtx(vSym));
    })(),
  },
];

test("fromString", () => {});

test.each(serializationTestCases)("fromString $str", ({ str, expr }) => {
  const result = fromString({ "": MOD }, str);
  // TODO: Need some kind of "symbol equivalency" for toEqual to work with lambdas
  expect(result).toEqual(expr);
});

test.each(serializationTestCases)("toString $str", ({ str, expr }) => {
  const result = expr.toString({ [MOD]: "" });
  expect(result).toEqual(str);
});
