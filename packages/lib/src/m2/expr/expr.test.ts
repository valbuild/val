import { type Token, tokenize } from "./expr";
import { promises as fs } from "fs";

const TokenizerTestCases: {
  input: string;
  expected: Token[];
  endCursor?: number;
}[] = [
  {
    input: "!(",
    expected: [
      {
        type: "!(",
        span: [0, 1],
      },
    ],
  },
  {
    input: "')'",
    expected: [
      {
        type: "'",
        span: [0, 0],
      },
      {
        type: "string",
        span: [1, 1],
        value: ")",
      },
      {
        type: "'",
        span: [2, 2],
      },
    ],
  },
  {
    input: "!(",
    expected: [
      {
        type: "!(",
        span: [0, 1],
      },
    ],
  },
  {
    input: "(",
    expected: [
      {
        type: "(",
        span: [0, 0],
      },
    ],
  },
  {
    input: "()",
    expected: [
      {
        type: "(",
        span: [0, 0],
      },
      {
        type: ")",
        span: [1, 1],
      },
    ],
  },
  {
    input: "'foo'",
    expected: [
      {
        type: "'",
        span: [0, 0],
      },
      {
        type: "string",
        span: [1, 3],
        value: "foo",
      },
      {
        type: "'",
        span: [4, 4],
      },
    ],
  },
  // this is the JS equivalent: 'f\'oo'
  {
    input: "'f\\'oo'",
    expected: [
      {
        type: "'",
        span: [0, 0],
      },
      {
        type: "string",
        span: [1, 5],
        value: "f'oo",
      },
      {
        type: "'",
        span: [6, 6],
      },
    ],
  },
  // this is the JS equivalent: 'f\\'oo'
  {
    input: "'f\\\\'oo'",
    expected: [
      {
        type: "'",
        span: [0, 0],
      },
      {
        type: "string",
        span: [1, 3],
        value: "f\\",
      },
      {
        type: "'",
        span: [4, 4],
      },
      {
        type: "token",
        span: [5, 6],
        value: "oo",
      },
      {
        type: "'",
        span: [7, 7],
      },
    ],
    endCursor: 6,
  },
  // fails on reserved chars
  {
    input: "(fo( (fail zoo))",
    expected: [
      { type: "(", span: [0, 0] },
      { type: "token", span: [1, 3], value: "fo@" },
      { type: "ws", span: [4, 4] },
      { type: "(", span: [5, 5] },
      { type: "token", span: [6, 9], value: "fail" },
      { type: "ws", span: [10, 10] },
      { type: "token", span: [11, 13], value: "zoo" },
      { type: ")", span: [14, 14] },
      { type: ")", span: [15, 15] },
    ],
  },
  // this is the JS equivalent: 'f\\\'oo'
  {
    input: "'f\\\\\\'oo'",
    expected: [
      {
        type: "'",
        span: [0, 0],
      },
      {
        type: "string",
        span: [1, 7],
        value: "f\\'oo",
      },
      {
        type: "'",
        span: [8, 8],
      },
    ],
  },
  {
    input: "(foo (bar zoo))",
    expected: [
      {
        type: "(",
        span: [0, 0],
      },
      {
        type: "token",
        span: [1, 3],
        value: "foo",
      },
      {
        type: "ws",
        span: [4, 4],
      },
      {
        type: "(",
        span: [5, 5],
      },
      {
        type: "token",
        span: [6, 8],
        value: "bar",
      },
      {
        type: "ws",
        span: [9, 9],
      },
      {
        type: "token",
        span: [10, 12],
        value: "zoo",
      },
      {
        type: ")",
        span: [13, 13],
      },
      {
        type: ")",
        span: [14, 14],
      },
    ],
  },
  {
    input: "  (foo (bar 'he\\'pp'   zoo))  ",
    expected: [
      {
        type: "ws",
        span: [0, 1],
      },
      {
        type: "(",
        span: [2, 2],
      },
      {
        type: "token",
        span: [3, 5],
        value: "foo",
      },
      {
        type: "ws",
        span: [6, 6],
      },
      {
        type: "(",
        span: [7, 7],
      },
      {
        type: "token",
        span: [8, 10],
        value: "bar",
      },
      {
        type: "ws",
        span: [11, 11],
      },
      {
        type: "'",
        span: [12, 12],
      },
      {
        type: "string",
        span: [13, 18],
        value: "he'pp",
      },
      {
        type: "'",
        span: [19, 19],
      },
      {
        type: "ws",
        span: [20, 22],
      },
      {
        type: "token",
        span: [23, 25],
        value: "zoo",
      },
      {
        type: ")",
        span: [26, 26],
      },
      {
        type: ")",
        span: [27, 27],
      },
      {
        type: "ws",
        span: [28, 29],
      },
    ],
  },
  {
    input: "''",
    expected: [
      {
        type: "'",
        span: [0, 0],
      },
      {
        type: "'",
        span: [1, 1],
      },
    ],
  },
  //interpolation:
  {
    input: "'${'str'}'",
    expected: [
      {
        type: "'",
        span: [0, 0],
      },
      {
        type: "${",
        span: [1, 2],
      },
      {
        type: "'",
        span: [3, 3],
      },
      {
        type: "string",
        span: [4, 6],
        value: "str",
      },
      {
        type: "'",
        span: [7, 7],
      },
      {
        type: "}",
        span: [8, 8],
      },
      {
        type: "'",
        span: [9, 9],
      },
    ],
  },
  {
    input: "'${'${(foo bar)}'}'",
    expected: [
      {
        type: "'",
        span: [0, 0],
      },
      {
        type: "${",
        span: [1, 2],
      },
      {
        type: "'",
        span: [3, 3],
      },
      {
        type: "${",
        span: [4, 5],
      },
      {
        type: "(",
        span: [6, 6],
      },
      {
        type: "token",
        span: [7, 9],
        value: "foo",
      },
      {
        type: "ws",
        span: [10, 10],
      },
      {
        type: "token",
        span: [11, 13],
        value: "bar",
      },
      {
        type: ")",
        span: [14, 14],
      },
      {
        type: "}",
        span: [15, 15],
      },
      {
        type: "'",
        span: [16, 16],
      },
      {
        type: "}",
        span: [17, 17],
      },
      {
        type: "'",
        span: [18, 18],
      },
    ],
  },
  {
    input: "'${'${'${(foo bar)}'}'}'",
    expected: [
      {
        type: "'",
        span: [0, 0],
      },
      {
        type: "${",
        span: [1, 2],
      },
      {
        type: "'",
        span: [3, 3],
      },
      {
        type: "${",
        span: [4, 5],
      },
      {
        type: "'",
        span: [6, 6],
      },
      {
        type: "${",
        span: [7, 8],
      },
      {
        type: "(",
        span: [9, 9],
      },
      {
        type: "token",
        span: [10, 12],
        value: "foo",
      },
      {
        type: "ws",
        span: [13, 13],
      },
      {
        type: "token",
        span: [14, 16],
        value: "bar",
      },
      {
        type: ")",
        span: [17, 17],
      },
      {
        type: "}",
        span: [18, 18],
      },
      {
        type: "'",
        span: [19, 19],
      },
      {
        type: "}",
        span: [20, 20],
      },
      {
        type: "'",
        span: [21, 21],
      },
      {
        type: "}",
        span: [22, 22],
      },
      {
        type: "'",
        span: [23, 23],
      },
    ],
  },
];

describe("expr", () => {
  test.each(TokenizerTestCases)('tokens: "$input"', ({ input, expected }) => {
    const [tokens] = tokenize(input);
    console.log(tokens);
    expect(tokens).toStrictEqual(expected);
  });
  test.each(TokenizerTestCases)(
    'end cursor: "$input"',
    ({ input, endCursor }) => {
      const [, cursor] = tokenize(input);
      expect(cursor).toStrictEqual(endCursor || input.length);
    }
  );

  test.each(TokenizerTestCases)(
    'expected spans overlap: "$input"', // checks if the EXPECTED spans in the test cases, not the code, to avoid PEBKAC test cases
    ({ input, expected, endCursor }) => {
      let [start, stop] = expected[0].span;
      for (let i = 1; i < expected.length; i++) {
        const [nextStart, nextStop] = expected[i].span;
        expect(nextStop).toBeGreaterThanOrEqual(nextStart);
        expect(stop + 1).toBe(nextStart);
        start = nextStart;
        stop = nextStop;
      }
      if (endCursor) {
        expect(input.length).not.toBe(endCursor);
      } else {
        expect(stop + 1).toBe(input.length);
      }
    }
  );
});
