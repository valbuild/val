import { type Token, tokenize } from "./expr";

const TokenizerTestCases: {
  input: string;
  expected: Partial<Token>[];
  endCursor?: number;
}[] = [
  {
    input: `!(`,
    expected: [{ type: "!(", span: [0, 1] }],
  },
  {
    input: `')'`,
    expected: [{ type: "string", span: [0, 3], value: ")" }],
  },
  { input: `!(`, expected: [{ type: "!(", span: [0, 1] }] },
  { input: `(`, expected: [{ type: "(", span: [0, 0] }] },
  {
    input: `()`,
    expected: [
      { type: "(", span: [0, 0] },
      { type: ")", span: [1, 1] },
    ],
  },
  {
    input: `'foo'`,
    expected: [{ type: "string", value: "foo", span: [0, 5] }],
  },
  // this is the JS equivalent: 'f\'oo'
  {
    input: "'f\\'oo'",
    expected: [{ type: "string", value: "f'oo", span: [0, 7] }],
  },
  // this is the JS equivalent: 'f\\'oo'
  {
    input: `'f\\\\'oo'`,
    expected: [
      { type: "string", span: [0, 5], value: "f\\" },
      { type: "token", span: [5, 7], value: "oo" },
    ],
    endCursor: 7,
  },
  // this is the JS equivalent: 'f\\\'oo'
  {
    input: `'f\\\\\\'oo'`,
    expected: [{ type: "string", value: "f\\'oo", span: [0, 9] }],
  },
  {
    input: `(foo (bar zoo))`,
    expected: [
      { type: "(", span: [0, 0] },
      { type: "token", span: [1, 4], value: "foo" },
      { type: "ws", span: [4, 5] },
      { type: "(", span: [5, 5] },
      { type: "token", span: [6, 9], value: "bar" },
      { type: "ws", span: [9, 10] },
      { type: "token", span: [10, 13], value: "zoo" },
      { type: ")", span: [13, 13] },
      { type: ")", span: [14, 14] },
    ],
  },
  {
    input: `  (foo (bar 'he\\'pp'   zoo))  `,
    expected: [
      { type: "ws", span: [0, 2] },
      { type: "(", span: [2, 2] },
      { type: "token", span: [3, 6], value: "foo" },
      { type: "ws", span: [6, 7] },
      { type: "(", span: [7, 7] },
      { type: "token", span: [8, 11], value: "bar" },
      { type: "ws", span: [11, 12] },
      { type: "string", span: [12, 20], value: "he'pp" },
      { type: "ws", span: [20, 23] },
      { type: "token", span: [23, 26], value: "zoo" },
      { type: ")", span: [26, 26] },
      { type: ")", span: [27, 27] },
      { type: "ws", span: [28, 30] },
    ],
  },
  {
    input: `''`,
    expected: [{ type: "string", span: [0, 2], value: "" }],
  },
  //interpolation:
  {
    input: `'\${'str'}'`,
    expected: [
      { type: "${", span: [1, 2] },
      { type: "string", span: [0, 3], value: "" },
      { type: "string", span: [3, 8], value: "str" },
      { type: "}", span: [8, 8] },
      { type: "string", span: [8, 10], value: "" },
    ],
  },
  {
    input: `'\${'\${(foo bar)}'}'`,
    expected: [
      { type: "${", span: [1, 2] },
      { type: "string", span: [0, 3], value: "" },
      { type: "${", span: [4, 5] },
      { type: "string", span: [3, 6], value: "" },
      { type: "(", span: [6, 6] },
      { type: "token", span: [7, 10], value: "foo" },
      { type: "ws", span: [10, 11] },
      { type: "token", span: [11, 14], value: "bar" },
      { type: ")", span: [14, 14] },
      { type: "}", span: [15, 15] },
      { type: "string", span: [15, 17], value: "" },
      { type: "}", span: [17, 17] },
      { type: "string", span: [17, 19], value: "" },
    ],
  },
  {
    input: `'\${'\${'\${(foo bar)}'}'}'`,
    expected: [
      { type: "${", span: [1, 2] },
      { type: "string", span: [0, 3], value: "" },
      { type: "${", span: [4, 5] },
      { type: "string", span: [3, 6], value: "" },
      { type: "${", span: [7, 8] },
      { type: "string", span: [6, 9], value: "" },
      { type: "(", span: [9, 9] },
      { type: "token", span: [10, 13], value: "foo" },
      { type: "ws", span: [13, 14] },
      { type: "token", span: [14, 17], value: "bar" },
      { type: ")", span: [17, 17] },
      { type: "}", span: [18, 18] },
      { type: "string", span: [18, 20], value: "" },
      { type: "}", span: [20, 20] },
      { type: "string", span: [20, 22], value: "" },
      { type: "}", span: [22, 22] },
      { type: "string", span: [22, 24], value: "" },
    ],
  },
];

describe("expr", () => {
  test.each(TokenizerTestCases)(
    'tokenize "$input"',
    ({ input, expected, endCursor }) => {
      const [tokens, cursor] = tokenize(input);
      expect(cursor).toStrictEqual(endCursor || input.length);
      expect(tokens).toStrictEqual(expected);
    }
  );

  test("eval", () => {
    // !(@) is an anon function equivalent to #(%) in clojure. Example: (map !(:"title" @))
    // console.log(tokenize(`'\${'\${(foo bar)}'}'`));
    // console.log(parse(`!(:0 @)`)); // (v) => v[0]
    // console.log(parse(`!(map !(json '{"title1": \${(:title @)}}') @)`)); // (v) => v.map((v, i) => v["title"])
    // console.log(
    //   parse(
    //     `!(:0 (map !(json '{"title1": \${(:'title' @)}, "text1": \${(:'text' @)}}')) @)`
    //   )
    // ); // (v) => v.map((v) => ({ "title1": v["title"], "text1": v["text"] }))[0]
  });
});

// (json '{"title": $(:title 'foo $('foo')') }'
