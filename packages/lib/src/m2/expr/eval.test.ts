import { result } from "../../fp";
import { Source } from "../selector";
import { evaluate } from "./eval";
import { parse } from "./parser";

const sources = {
  "/numbers": [1, 2, 3],
  "/articles": [{ title: "title1" }, { title: "title2" }],
};

const EvalTestCases = [
  {
    // TODO: should we do ('numbers' val) to be more consistent?
    expr: `(length (val '/numbers'))`,
    expected: result.ok(sources["/numbers"].length),
  },
  {
    expr: `(slice (val '/numbers') 0 2)`,
    expected: result.ok(sources["/numbers"].slice(0, 2)),
  },
  {
    expr: `(reverse (val '/numbers') ())`,
    expected: result.ok(sources["/numbers"].slice().reverse()), // reverse is mutable so slice / copy before reverse
  },
  {
    expr: `('0' (val '/articles'))`,
    expected: result.ok(sources["/articles"][0]),
  },
  {
    expr: `!(map (val '/articles') @[0,0])`,
    expected: result.ok(sources["/articles"].map((v) => v)),
  },
  {
    expr: `!(map (val '/articles') ('title' @[0,0]))`,
    expected: result.ok(sources["/articles"].map((v) => v["title"])),
  },
  {
    expr: `!(map (val '/articles') 
                 (slice ('title' @[0,0])
                        0
                        2))`,
    expected: result.ok(
      sources["/articles"].map((v) => v["title"].slice(0, 2))
    ),
  },
  {
    expr: `!(map (val '/articles')
                 !(map (val '/numbers')
                       (slice ('title' @[0,0])
                              0
                              @[1,1])))`,
    expected: result.ok(
      sources["/articles"].map((v) =>
        sources["/numbers"].map((_, i) => v["title"].slice(0, i))
      )
    ),
  },
];

describe("eval", () => {
  test.each(EvalTestCases)('evaluate: "$expr"', ({ expr, expected }) => {
    const parseRes = parse(expr);
    if (result.isErr(parseRes)) {
      return expect(parseRes).toHaveProperty("value");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(
      evaluate(
        parseRes.value,
        (ref) => sources[ref as keyof typeof sources] as unknown as Source,
        []
      )
    ).toStrictEqual(expected);
  });
  //
});
