/* eslint-disable @typescript-eslint/no-explicit-any */

import { createValPathOfItem } from "../selector/future/SelectorProxy";
import { SourcePath } from "../val";
import { array } from "./array";
import { boolean } from "./boolean";
import { literal } from "./literal";
import { number } from "./number";
import { object } from "./object";
import { string } from "./string";
import { file as fileVal } from "../source/file";
import { richtext as richtextVal } from "../source/richtext";
import { image } from "./image";
import { ValidationFix } from "./validation/ValidationFix";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";
import { richtext } from "./richtext";

const testPath = "/test" as SourcePath;
const pathOf = (p: string | symbol | number) => {
  return createValPathOfItem(testPath, p);
};
const ValidationTestCases: {
  description: string;
  input: any;
  schema: any;
  expected: [SourcePath | undefined] | false;
  fixes?: {
    [path: string]: ValidationFix[];
  };
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
    description: "failing boolean (null)",
    input: null,
    schema: boolean(),
    expected: [testPath],
  },
  {
    description: "optional boolean (null)",
    input: null,
    schema: boolean().optional(),
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
  // object
  {
    description: "basic object(string)",
    input: { one: "one val", two: 2 },
    schema: object({
      one: string(),
      two: number(),
    }),
    expected: false,
  },
  {
    description: "basic object(string)",
    input: { one: "one val", two: 1 },
    schema: object({
      one: string(),
      two: string(),
    }),
    expected: [pathOf("two")],
  },
  // image / file
  {
    description: "optional image",
    input: null,
    schema: image().optional(),
    expected: false,
  },
  {
    description: "failure image:: null",
    input: null,
    schema: image(),
    expected: [testPath],
  },
  {
    description: "failure image: replace metadata",
    input: fileVal("test", {
      width: 100,
      height: 100,
      sha256: "test",
    }),
    schema: image(),
    expected: [testPath],
    fixes: {
      [testPath]: ["image:replace-metadata"],
    },
  },
  {
    description: "failure image: check metadata",
    input: fileVal("test", {
      width: 100,
      height: 100,
      sha256:
        "9e420dc93157ab98338542ba6f1d34fcf829d646aa729a86720fa3f4cb2d0076",
    }),
    schema: image(),
    expected: [testPath],
    fixes: {
      [testPath]: ["image:replace-metadata"],
    },
  },
  // richtext
  {
    description: "basic richtext",
    input: richtextVal("test"),
    expected: false,
    schema: richtext(),
  },
  // TODO: more richtext cases
  // TODO: union
  // TODO: oneOf
  // TODO: i18n
];

describe("validation", () => {
  test.each(ValidationTestCases)(
    'validate ($description): "$expected"',
    ({ input, schema, expected, fixes }) => {
      const result = schema.validate(testPath, input);
      if (result) {
        expect(Object.keys(result)).toStrictEqual(expected);
        if (fixes) {
          expect(
            Object.fromEntries(
              Object.entries(result as ValidationErrors).map(
                ([path, errors]) => [
                  path,
                  errors.flatMap((error: ValidationError) => error.fixes),
                ]
              )
            )
          ).toStrictEqual(fixes);
        }
      } else {
        expect(result).toStrictEqual(expected);
      }
    }
  );
});
