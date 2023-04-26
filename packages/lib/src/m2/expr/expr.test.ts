import { parse, Token, tokenize, ParseError } from "./expr";

function noSpan(tokens: Token[]) {
  return tokens.map((token) => {
    if (token.value) {
      return {
        type: token.type,
        value: token.value,
      };
    }
    return {
      type: token.type,
    };
  });
}

const TokenizerTestCases = [
  {
    input: `!(`,
    ignoreSpans: false,
    expected: [{ type: "!(", span: [0, 1] }],
  },
  {
    input: `')'`,
    expected: [{ type: "string", span: [0, 1], value: ")" }],
    ignoreSpans: true,
  },
  { input: `!(`, expected: [{ type: "!(" }], ignoreSpans: true },
  { input: `(`, expected: [{ type: "(" }], ignoreSpans: true },
  { input: `()`, expected: [{ type: "(" }, { type: ")" }], ignoreSpans: true },
  {
    input: `'foo'`,
    expected: [{ type: "string", value: "foo", span: [0, 3] }],
    ignoreSpans: true,
  },
  // this is the JS equivalent: 'f\'oo'
  // {
  //   input: `'f\\'oo'`,
  //   expected: [{ type: "string", value: "f'oo", span: [0, 5] }],
  //   ignoreSpans: true,
  // },
  // // this is the JS equivalent: 'f\\'oo'
  // // {input: `'f\\\\'oo'`, error: ParseError},
  // // this is the JS equivalent: 'f\\\'oo'
  // {
  //   input: `'f\\\\\\'oo'`,
  //   expected: [{ type: "string", value: "f\\'oo", span: [0, 8] }],
  //   ignoreSpans: true,
  // },
  // {
  //   input: `(foo (bar zoo))`,
  //   expected: [
  //     { type: "(", span: [0, 0] },
  //     { type: "token", span: [1, 4], value: "foo" },
  //     { type: "ws", span: [4, 5] },
  //     { type: "(", span: [5, 5] },
  //     { type: "token", span: [6, 9], value: "bar" },
  //     { type: "ws", span: [9, 10] },
  //     { type: "token", span: [10, 13], value: "zoo" },
  //     { type: ")", span: [13, 13] },
  //     { type: ")", span: [14, 14] },
  //   ],
  //   ignoreSpans: true,
  // },
  // {
  //   input: `  (foo (bar 'he\\'pp'   zoo))  `,
  //   expected: [
  //     { type: "ws" },
  //     { type: "(", span: [2, 2] },
  //     { type: "token", span: [3, 6], value: "foo" },
  //     { type: "ws" },
  //     { type: "(", span: [7, 7] },
  //     { type: "token", span: [8, 11], value: "bar" },
  //     { type: "ws" },
  //     { type: "string", span: [12, 19], value: "he'pp" },
  //     { type: "ws" },
  //     { type: "token", span: [23, 26], value: "zoo" },
  //     { type: ")", span: [26, 26] },
  //     { type: ")", span: [27, 27] },
  //     { type: "ws" },
  //   ],
  //   ignoreSpans: true,
  // }
  {
    input: `''`,
    ignoreSpans: true,
    expected: [{ type: "string", span: [0, 2], value: "" }],
  },
  //interpolation:
  {
    input: `'\${'str'}'`,
    ignoreSpans: true,
    expected: [
      { type: "string", span: [0, 2], value: "" },
      // { type: "${", span: [0, 2] },
      { type: "string", span: [3, 7], value: "str" },
      // { type: "}", span: [8, 8] },
      { type: "string", span: [9, 10], value: "" },
    ],
  },
  {
    input: `'\${'\${(foo bar)}'}'`,
    ignoreSpans: true,
    expected: [
      { type: "string", span: [0, 1], value: "" },
      { type: "${", span: [1, 2] },
      { type: "string", span: [3, 4], value: "" },
      { type: "${", span: [4, 5] },
      { type: "(", span: [6, 6] },
      { type: "token", span: [7, 10], value: "foo" },
      { type: "ws", span: [10, 11] },
      { type: "token", span: [11, 14], value: "bar" },
      { type: ")", span: [14, 14] },
      { type: "}", span: [15, 15] },
      { type: "string", span: [16, 16], value: "" },
      { type: "}", span: [17, 17] },
      { type: "string", span: [18, 18], value: "" },
    ],
  },
];
describe("expr", () => {
  test.each(TokenizerTestCases)(
    'tokenize "$input"',
    ({ input, ignoreSpans, expected }) => {
      if (ignoreSpans) {
        expect(noSpan(tokenize(input))).toStrictEqual(noSpan(expected));
      } else {
        expect(tokenize(input)).toStrictEqual(expected);
      }
    }
  );

  test("eval", () => {
    // !(@) is an anon function equivalent to #(%) in clojure. Example: (map !(:"title" @))
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
