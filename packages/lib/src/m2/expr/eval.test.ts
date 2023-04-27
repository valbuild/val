import { result } from "../../fp";
import { Source } from "../selector";
import { evaluate } from "./eval";
import { parse } from "./parser";

function createCase<S extends Source>(testCase: {
  expr: string;
  source: S;
  expected: (source: S) => unknown;
}) {
  return testCase;
}

const EvalTestCases = [
  createCase({
    expr: `(length)`,
    source: [1, 2, 3],
    expected: (source) => source.length,
  }),
  // createCase({
  //   expr: `(map (: 'title' @0[1]) (ref '/app/blogs'))`,
  //   source: [{ title: "test" }],
  //   expected: (source) => source.map((v) => v.title),
  // }),
  // createCase({
  //   expr: `(map (map (: 'name' @0) (: 'tags' @0)))`,
  //   source: [{ title: "test", tags: [{ name: "foo" }] }],
  //   expected: (source) => source.map((v) => v.tags.map((v) => v.name)),
  // }),
  // createCase({
  //   expr: `(map (map (+ (: 'name' @1) (: 'title' @0)) (: 'tags' @0)))`,
  //   source: [{ title: "test", tags: [{ name: "foo" }] }],
  //   expected: (source) =>
  //     source.map((blog) => blog.tags.map((tag) => tag.name + blog.title)),
  // }),
  // createCase({
  //   expr: `(map (:title) )`,
  //   source: [{ title: "test", tags: [{ name: "foo" }] }],
  //   expected: (source) =>
  //     source.map((blog) => blog.tags.map((tag) => tag.name + blog.title)),
  // }),
];

describe("eval", () => {
  test.each(EvalTestCases)(
    'evaluate: "$expr"',
    ({ expr, expected, source }) => {
      const parseRes = parse(expr);
      if (result.isErr(parseRes)) {
        return expect(parseRes).toHaveProperty("value");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(evaluate(parseRes.value, source)).toBe(expected(source as any));
    }
  );
  //
});
