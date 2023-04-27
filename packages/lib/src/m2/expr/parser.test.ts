import { result } from "../../fp";
import { SExpr } from "./expr";
import { parse, ParserError } from "./parser";

const ParserTestCases: {
  input: string;
  expected: result.Result<SExpr[], ParserError>;
}[] = [
  {
    input: "(map fn value)",
    expected: result.ok([]),
  },
];

describe("parser", () => {
  test.each(ParserTestCases)('expr: "$input"', ({ input, expected }) => {
    const res = parse(input);
  });
});
