import { result } from "../../fp";
import { Expr } from "./expr";
import { parse, ParserError } from "./parser";

const ParserTestCases: {
  input: string;
  error?: {
    span: [start: number, stop: number];
  };
  overrideTest?: string;
}[] = [
  {
    input: "!(",
    error: {
      span: [0, 2], // TODO:
    },
  },
  {
    input: "')'",
  },
  {
    input: "(",
    error: {
      span: [0, 0],
    },
  },
  {
    input: "(b ab)", // single character tokens
  },
  {
    input: "!(map fn value)",
  },
  {
    input: "!(map (map foo bar) value)",
  },
  {
    input: "'foo'",
  },
  // this is the JS equivalent: 'f\'oo'
  {
    input: "'f\\'oo'",
  },
  // lenient tokenization (errors must handled by the parser)
  // this is the JS equivalent: 'f\\'oofail'
  {
    input: "'f\\\\'oo'fail",
    error: {
      span: [5, 11],
    },
  },
  {
    input: "(fo() (fail zoo))",
    error: {
      span: [1, 3], // this would preferably be [1, 4]
    },
  },
  // this is the JS equivalent: 'f\\\'oo'
  {
    input: "'f\\\\\\'oo'",
  },
  {
    input: "(foo (bar zoo))",
  },
  {
    input: "  (foo (bar 'he\\'pp'   zoo))  ",
    overrideTest: "(foo (bar 'he\\'pp' zoo))",
  },
  {
    input: "''",
  },
  //interpolation:
  {
    input: "'${'str'}'",
    overrideTest: "'str'",
  },
  {
    input: "'${'${(foo bar)}'}'",
  },
  {
    input: "'foo${(bar baz)}'",
  },
  {
    input: "'${'foo ${(foo bar)}'}'",
  },
  {
    input: "'${'${'${(foo bar)}'}'}'",
  },
  {
    input: `(json '{"foo": "bar"}')`,
  },
  {
    input: `(json '{"foo": \${(foo bar)}}')`,
  },
  {
    input: `(json '{"foo": \${(foo bar)}, "baz": "baz"}')`,
  },
  {
    input: `!(map 'title' )`,
    overrideTest: `!(map 'title')`,
  },
  {
    input: `!(map
      (ref '/foo/bar')
      ('title' @0)
    )`,
    overrideTest: `!(map (ref '/foo/bar') ('title' @0))`,
  },
];

describe("parser", () => {
  test.each(ParserTestCases)(
    'expr: "$input"',
    ({ input, error, overrideTest }) => {
      const res = parse(input);
      if (error) {
        if (result.isErr(res)) {
          expect(res.error.span).toEqual(error.span);
        } else {
          expect(res).toHaveProperty("error");
        }
      } else if (result.isErr(res)) {
        process.stdout.write(res.error.message + ":\n\n");
        process.stdout.write(input + "\n");
        let underline = "";
        for (let i = 0; i < input.length; i++) {
          if (i >= res.error.span[0] && i <= res.error.span[1]) {
            underline += "^";
          } else {
            if (input[i] === "\n") {
              if (!underline.includes("^")) {
                underline = "";
              }
            } else {
              underline += " ";
            }
          }
        }
        process.stderr.write(underline + "\n");
        expect(res).toHaveProperty("value");
      } else {
        expect(res.value.serialize()).toBe(overrideTest || input);
      }
    }
  );
});
