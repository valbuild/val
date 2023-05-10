import { convertLiteralProxy, newExprSelectorProxy } from "./ExprProxy";
import * as expr from "../expr/expr";
import {
  AsVal,
  SelectorC,
  SelectorSource,
  VAL_OR_EXPR,
  ArraySourceBranded,
} from ".";
import { Source } from "../Source";

const ExprSelectorTestCases: any[] = [
  {
    description: "basic module",
    input: newExprSelectorProxy<string>(root("/app/foo")),
    expected: "(val '/app/foo')",
  },
  {
    description: "basic prop",
    input: newExprSelectorProxy<ArraySourceBranded<string[]>>(
      root("/app/foo")
    )[0],
    expected: "('0' (val '/app/foo'))",
  },
  {
    description: "noop andThen",
    input: newExprSelectorProxy<string>(root("/app/foo")).andThen((v) => v),
    expected: "!(andThen (val '/app/foo') @[0,0])",
  },
  {
    description: "noop map",
    input: newExprSelectorProxy<ArraySourceBranded<string[]>>(
      root("/app/foo")
    ).map((v) => v),
    expected: "!(map (val '/app/foo') @[0,0])",
  },
  {
    description: "eq string",
    input: newExprSelectorProxy<string>(root("/app/foo")).eq("hei"),
    expected: "(eq (val '/app/foo') 'hei')",
  },
  {
    description: "eq undefined",
    input: newExprSelectorProxy<undefined>(root("/app/foo")).eq(undefined),
    expected: "(eq (val '/app/foo') ())",
  },
  {
    description: "eq number",
    input: newExprSelectorProxy<number>(root("/app/foo")).eq(1),
    expected: "(eq (val '/app/foo') (json '1'))",
  },
  {
    description: "eq boolean",
    input: newExprSelectorProxy<boolean>(root("/app/foo")).eq(true),
    expected: "(eq (val '/app/foo') (json 'true'))",
  },
  {
    description: "filter string",
    input: newExprSelectorProxy<ArraySourceBranded<string[]>>(
      root("/app/foo")
    ).filter((v) => v.eq("hei")),
    expected: "!(filter (val '/app/foo') (eq @[0,0] 'hei'))",
  },
  {
    description: "filter number",
    input: newExprSelectorProxy<ArraySourceBranded<number[]>>(
      root("/app/foo")
    ).filter((v) => v.eq(1)),
    expected: "!(filter (val '/app/foo') (eq @[0,0] (json '1')))",
  },
  {
    description: "filter optional",
    input: newExprSelectorProxy<ArraySourceBranded<number[]>>(
      root("/app/foo")
    ).filter((v) => v.eq(undefined)),
    expected: "!(filter (val '/app/foo') (eq @[0,0] ()))",
  },
  {
    description: "basic projection",
    input: newExprSelectorProxy<ArraySourceBranded<string[]>>(
      root("/app/foo")
    ).map((v) => ({
      foo: v,
    })),
    expected: "!(map (val '/app/foo') (json '{\"foo\": ${@[0,0]}}'))",
  },
  {
    description: "nested projection",
    input: newExprSelectorProxy<ArraySourceBranded<string[]>>(
      root("/app/foo")
    ).map((v) => ({
      foo: {
        bar: v,
      },
    })),
    expected:
      // TODO: this could be more readable
      // Example: "!(map (val '/app/foo') (json '{\"foo\": {\"bar\": {${@[0,0]}}'}'))"
      "!(map (val '/app/foo') (json '{\"foo\": ${'{\"bar\": ${@[0,0]}}'}}'))",
  },
  {
    description: "multi module",
    input: newExprSelectorProxy<string>(root("/app/foo")).andThen(() =>
      newExprSelectorProxy<string[]>(root("/app/bar"))
    ),
    expected: "!(andThen (val '/app/foo') (val '/app/bar'))",
  },
];

/**
 * Useful test cases for literal conversion
 * There somewhat of an overlap between these cases and the selector cases,
 * we could prune some of these away if we want to
 **/
const LiteralConversionTestCases: {
  input: SelectorSource;
  expected: string;
  description: string;
}[] = [
  { description: "basic string", input: "foo", expected: "(json '\"foo\"')" },
  { description: "basic number", input: 1, expected: "(json '1')" },
  { description: "basic boolean", input: true, expected: "(json 'true')" },
  { description: "basic array", input: [1], expected: "(json '[1]')" },
  { description: "basic undefined", input: undefined, expected: "()" },
  {
    description: "array with 2 different",
    input: [1, "foo"],
    expected: "(json '[1, \"foo\"]')",
  },
  {
    description: "array with undefined",
    input: [1, undefined],
    expected: "(json '[1, ${()}]')",
  },
  {
    description: "basic object",
    input: { foo: "one", bar: 1 },
    expected: '(json \'{"foo": "one", "bar": 1}\')',
  },
  {
    description: "nested array",
    input: [1, [1]],
    expected: "(json '[1, [1]]')",
  },
  {
    description: "nested object",
    input: { foo: "one", bar: { zoo: 1 } },
    expected: '(json \'{"foo": "one", "bar": {"zoo": 1}}\')',
  },
  {
    description: "nested object with array",
    input: {
      foo: "one",
      bar: { zoo: [1, "inner"] },
    },
    expected: '(json \'{"foo": "one", "bar": {"zoo": [1, "inner"]}}\')',
  },
  {
    description: "basic interpolation",
    input: [1, newExprSelectorProxy<string[]>(root("/app/foo"))],
    expected: "(json '[1, ${(val '/app/foo')}]')",
  },
  {
    description: "advanced interpolation",
    input: [
      123,
      newExprSelectorProxy<string[]>(root("/app/foo")).map((v) =>
        v.andThen((a) => ({ bar: a.eq("bar") }))
      ),
    ],
    expected:
      "(json '[123, ${!(map (val '/app/foo') !(andThen @[0,0] (json '{\"bar\": ${(eq @[1,0] 'bar')}}')))}]')",
  },
  {
    description: "interpolation with multiple selectors",
    input: [
      123,
      newExprSelectorProxy<string[]>(root("/app/foo")).map((v) =>
        v.andThen((a) => ({
          bar: a.eq("bar"),
          more: newExprSelectorProxy<string[]>(root("/app/foo")),
        }))
      ),
    ],
    expected:
      "(json '[123, ${!(map (val '/app/foo') !(andThen @[0,0] (json '{\"bar\": ${(eq @[1,0] 'bar')}, \"more\": ${(val '/app/foo')}}')))}]')",
  },
];

describe("expr", () => {
  test.each(ExprSelectorTestCases)(
    'expr selector ($description): "$expected"',
    ({ input, expected }) => {
      const valOrExpr = (input as unknown as AsVal<Source>)[VAL_OR_EXPR]();
      if (valOrExpr instanceof expr.Expr) {
        expect(valOrExpr.transpile()).toBe(expected);
      } else {
        expect(valOrExpr).toBe(expect.any(expr.Expr));
      }
    }
  );
  test.each(LiteralConversionTestCases)(
    'literal conversion ($description): "$expected"',
    ({ input, expected }) =>
      expect(convertLiteralProxy(input).transpile()).toBe(expected)
  );
});

function root(sourcePath: string) {
  return new expr.Call(
    [new expr.Sym("val"), new expr.StringLiteral(sourcePath)],
    false
  );
}
