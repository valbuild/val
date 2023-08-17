/* eslint-disable @typescript-eslint/no-explicit-any */

import { createValPathOfItem } from "../selector/SelectorProxy";
import { SourcePath } from "../val";
import { array } from "./array";
import { boolean } from "./boolean";
import { literal } from "./literal";
import { number } from "./number";
import { string } from "./string";

const testPath = "/test" as SourcePath;
const pathOf = (p: string | symbol | number) => {
  return createValPathOfItem(testPath, p);
};
const ValidationTestCases: {
  description: string;
  input: any;
  schema: any;
  expected: [SourcePath | undefined] | false;
}[] = [
  // boolean
  {
    description: "basic boolean (true)",
    input: true,
    schema: boolean(),
    expected: false,
  },
  {
    description: "basic boolean (false)",
    input: false,
    schema: boolean(),
    expected: false,
  },
  {
    description: "failing boolean",
    input: "false",
    schema: boolean(),
    expected: [testPath],
  },
  // number
  {
    description: "basic number (0)",
    input: 0,
    schema: number(),
    expected: false,
  },
  {
    description: "basic number (-1)",
    input: -1,
    schema: number(),
    expected: false,
  },
  {
    description: "basic number (1)",
    input: 1,
    schema: number(),
    expected: false,
  },
  {
    description: "basic number (1)",
    input: 1,
    schema: number(),
    expected: false,
  },
  // string
  {
    description: "basic string",
    input: "two",
    schema: string(),
    expected: false,
  },
  {
    description: "failing string",
    input: 1,
    schema: string(),
    expected: [testPath],
  },
  // literal
  {
    description: "basic literal",
    input: "one",
    schema: literal("one"),
    expected: false,
  },
  {
    description: "failing literal",
    input: "two",
    schema: literal("one"),
    expected: [testPath],
  },
  // array
  {
    description: "basic array(string)",
    input: ["one", "two"],
    schema: array(string()),
    expected: false,
  },
  {
    description: "failing array(string)",
    input: [true, "false"],
    schema: array(string()),
    expected: [pathOf(0)],
  },
  // TODO: object
  // TODO: image
  // TODO: union
  // TODO: oneOf
  // TODO: i18n
  // TODO: richtext
];

describe("validation", () => {
  test.each(ValidationTestCases)(
    'validate ($description): "$expected"',
    ({ input, schema, expected }) => {
      const result = schema.validate(testPath, input);
      console.log(JSON.stringify({ result, expected }, null, 2));
      if (result) {
        expect(Object.keys(result)).toStrictEqual(expected);
      } else {
        expect(result).toStrictEqual(expected);
      }
    }
  );
});
