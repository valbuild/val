import { type Token, tokenize } from "./tokenizer";

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
    input: "(b ab)", // single character tokens
    expected: [
      { type: "(", span: [0, 0] },
      { type: "token", span: [1, 1], value: "b" },
      { type: "ws", span: [2, 2] },
      { type: "token", span: [3, 4], value: "ab" },
      { type: ")", span: [5, 5] },
    ],
  },
  {
    input: "(map fn value)",
    expected: [
      { type: "(", span: [0, 0] },
      { type: "token", span: [1, 3], value: "map" },
      { type: "ws", span: [4, 4] },
      { type: "token", span: [5, 6], value: "fn" },
      { type: "ws", span: [7, 7] },
      { type: "token", span: [8, 12], value: "value" },
      { type: ")", span: [13, 13] },
    ],
  },
  {
    input: "(map (map foo bar) value)",
    expected: [
      { type: "(", span: [0, 0] },
      { type: "token", span: [1, 3], value: "map" },
      { type: "ws", span: [4, 4] },
      { type: "(", span: [5, 5] },
      { type: "token", span: [6, 8], value: "map" },
      { type: "ws", span: [9, 9] },
      { type: "token", span: [10, 12], value: "foo" },
      { type: "ws", span: [13, 13] },
      { type: "token", span: [14, 16], value: "bar" },
      { type: ")", span: [17, 17] },
      { type: "ws", span: [18, 18] },
      { type: "token", span: [19, 23], value: "value" },
      { type: ")", span: [24, 24] },
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
        unescapedValue: "f\\'oo",
      },
      {
        type: "'",
        span: [6, 6],
      },
    ],
  },
  // lenient tokenization (errors must handled by the parser)
  // this is the JS equivalent: 'f\\'oofail'
  {
    input: "'f\\\\'oo'fail",
    expected: [
      { type: "'", span: [0, 0] },
      { type: "string", span: [1, 3], value: "f\\", unescapedValue: "f\\\\" },
      { type: "'", span: [4, 4] },
      { type: "token", span: [5, 6], value: "oo" },
      { type: "'", span: [7, 7] },
      { type: "string", span: [8, 11], value: "fail" },
    ],
    endCursor: 12,
  },
  {
    input: "(fo() (fail zoo))",
    expected: [
      { type: "(", span: [0, 0] },
      { type: "token", span: [1, 3], value: "fo(" }, // tokenizer tries it best, even though ( is not allowed in tokens
      { type: ")", span: [4, 4] },
      { type: "ws", span: [5, 5] },
      { type: "(", span: [6, 6] },
      { type: "token", span: [7, 10], value: "fail" },
      { type: "ws", span: [11, 11] },
      { type: "token", span: [12, 14], value: "zoo" },
      { type: ")", span: [15, 15] },
      { type: ")", span: [16, 16] },
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
        unescapedValue: "f\\\\\\'oo",
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
        unescapedValue: "he\\'pp",
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
      { type: "'", span: [0, 0] },
      { type: "${", span: [1, 2] },
      { type: "'", span: [3, 3] },
      { type: "${", span: [4, 5] },
      { type: "(", span: [6, 6] },
      { type: "token", span: [7, 9], value: "foo" },
      { type: "ws", span: [10, 10] },
      { type: "token", span: [11, 13], value: "bar" },
      { type: ")", span: [14, 14] },
      { type: "}", span: [15, 15] },
      { type: "'", span: [16, 16] },
      { type: "}", span: [17, 17] },
      { type: "'", span: [18, 18] },
    ],
  },
  {
    input: "'foo${(bar baz)}'",
    expected: [
      { type: "'", span: [0, 0] },
      { type: "string", span: [1, 3], value: "foo" },
      { type: "${", span: [4, 5] },
      { type: "(", span: [6, 6] },
      { type: "token", span: [7, 9], value: "bar" },
      { type: "ws", span: [10, 10] },
      { type: "token", span: [11, 13], value: "baz" },
      { type: ")", span: [14, 14] },
      { type: "}", span: [15, 15] },
      { type: "'", span: [16, 16] },
    ],
  },
  {
    input: "'${'foo ${(foo bar)}'}'",
    expected: [
      { type: "'", span: [0, 0] },
      { type: "${", span: [1, 2] },
      { type: "'", span: [3, 3] },
      { type: "string", span: [4, 7], value: "foo " },
      { type: "${", span: [8, 9] },
      { type: "(", span: [10, 10] },
      { type: "token", span: [11, 13], value: "foo" },
      { type: "ws", span: [14, 14] },
      { type: "token", span: [15, 17], value: "bar" },
      { type: ")", span: [18, 18] },
      { type: "}", span: [19, 19] },
      { type: "'", span: [20, 20] },
      { type: "}", span: [21, 21] },
      { type: "'", span: [22, 22] },
    ],
  },
  {
    input: "'${'${'${(foo bar)}'}'}'",
    expected: [
      { type: "'", span: [0, 0] },
      { type: "${", span: [1, 2] },
      { type: "'", span: [3, 3] },
      { type: "${", span: [4, 5] },
      { type: "'", span: [6, 6] },
      { type: "${", span: [7, 8] },
      { type: "(", span: [9, 9] },
      { type: "token", span: [10, 12], value: "foo" },
      { type: "ws", span: [13, 13] },
      { type: "token", span: [14, 16], value: "bar" },
      { type: ")", span: [17, 17] },
      { type: "}", span: [18, 18] },
      { type: "'", span: [19, 19] },
      { type: "}", span: [20, 20] },
      { type: "'", span: [21, 21] },
      { type: "}", span: [22, 22] },
      { type: "'", span: [23, 23] },
    ],
  },
  {
    input: `(json '{"foo": "bar"}')`,
    expected: [
      { type: "(", span: [0, 0] },
      { type: "token", span: [1, 4], value: "json" },
      { type: "ws", span: [5, 5] },
      { type: "'", span: [6, 6] },
      { type: "string", span: [7, 20], value: '{"foo": "bar"}' },
      { type: "'", span: [21, 21] },
      { type: ")", span: [22, 22] },
    ],
  },
  {
    input: `(json '{"foo": \${(foo bar)}}')`,
    expected: [
      { type: "(", span: [0, 0] },
      { type: "token", span: [1, 4], value: "json" },
      { type: "ws", span: [5, 5] },
      { type: "'", span: [6, 6] },
      { type: "string", span: [7, 14], value: '{"foo": ' },
      { type: "${", span: [15, 16] },
      { type: "(", span: [17, 17] },
      { type: "token", span: [18, 20], value: "foo" },
      { type: "ws", span: [21, 21] },
      { type: "token", span: [22, 24], value: "bar" },
      { type: ")", span: [25, 25] },
      { type: "}", span: [26, 26] },
      { type: "string", span: [27, 27], value: "}" },
      { type: "'", span: [28, 28] },
      { type: ")", span: [29, 29] },
    ],
  },
  {
    input: `(json '{"foo": \${(foo bar)}, "baz": "baz"}')`,
    expected: [
      { type: "(", span: [0, 0] },
      { type: "token", span: [1, 4], value: "json" },
      { type: "ws", span: [5, 5] },
      { type: "'", span: [6, 6] },
      { type: "string", span: [7, 14], value: '{"foo": ' },
      { type: "${", span: [15, 16] },
      { type: "(", span: [17, 17] },
      { type: "token", span: [18, 20], value: "foo" },
      { type: "ws", span: [21, 21] },
      { type: "token", span: [22, 24], value: "bar" },
      { type: ")", span: [25, 25] },
      { type: "}", span: [26, 26] },
      { type: "string", span: [27, 41], value: ', "baz": "baz"}' },
      { type: "'", span: [42, 42] },
      { type: ")", span: [43, 43] },
    ],
  },
];

describe("tokenizer", () => {
  test.each(TokenizerTestCases)('tokens: "$input"', ({ input, expected }) => {
    const [tokens] = tokenize(input);
    console.log(input, input.length, tokens);
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
      let [, stop] = expected[0].span;
      for (let i = 1; i < expected.length; i++) {
        const [nextStart, nextStop] = expected[i].span;
        expect(nextStop).toBeGreaterThanOrEqual(nextStart);
        expect(stop + 1).toBe(nextStart);
        stop = nextStop;
      }
      if (endCursor === undefined) {
        expect(stop + 1).toBe(input.length);
      }
    }
  );

  test.each(TokenizerTestCases)(
    'expected span equals input at span positions: "$input"',
    ({ input, expected }) => {
      for (const token of expected) {
        if (token.type === "ws") continue;
        expect(input.slice(token.span[0], token.span[1] + 1)).toBe(
          token.unescapedValue || token.value || token.type
        );
      }
    }
  );
});
