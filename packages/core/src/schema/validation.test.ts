/* eslint-disable @typescript-eslint/no-explicit-any */

import { SourcePath } from "../val";
import { array } from "./array";
import { boolean } from "./boolean";
import { literal } from "./literal";
import { number } from "./number";
import { object } from "./object";
import { string } from "./string";
import { image } from "./image";
import { ValidationFix } from "./validation/ValidationFix";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";
import { richtext } from "./richtext";
import { record } from "./record";
import { keyOf } from "./keyOf";
import { define } from "../module";
import { union } from "./union";
import { createValPathOfItem } from "../selector/SelectorProxy";
import { date } from "./date";
import { svg } from "./svg";
import { initFile } from "../source/file";

const fileVal = initFile();
const testPath = "/test" as SourcePath;
const pathOf = (p: string | symbol | number) => {
  return createValPathOfItem(testPath, p);
};
/** testPath with a sub-path appended, keeping the SourcePath brand. */
const subPathOf = (p: string | symbol | number, rest: string) => {
  return (createValPathOfItem(testPath, p) + rest) as SourcePath;
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
    description: "nullable boolean (null)",
    input: null,
    schema: boolean().nullable(),
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
  {
    description: "basic null nullable string",
    input: null,
    schema: string().nullable(),
    expected: false,
  },
  {
    description: "nested nullable string",
    input: { test: null },
    schema: object({ test: string().nullable() }).nullable(),
    expected: false,
  },
  {
    description: "basic nullable string",
    input: "two",
    schema: string().nullable(),
    expected: false,
  },
  {
    description: "failing max length",
    input: "three",
    schema: string().maxLength(3),
    expected: [testPath],
  },
  {
    description: "basic max length",
    input: "two",
    schema: string().maxLength(3),
    expected: false,
  },
  {
    description: "failing min length",
    input: "a",
    schema: string().minLength(3),
    expected: [testPath],
  },
  {
    description: "basic min length",
    input: "two",
    schema: string().minLength(3),
    expected: false,
  },
  {
    description: "basic reg exp",
    input: "two",
    schema: string().regexp(/two|three/),
    expected: false,
  },
  {
    description: "failing reg exp",
    input: "one",
    schema: string().regexp(/two|three/),
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
    description: "basic literal nullable",
    input: "one",
    schema: literal("one").nullable(),
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
    description: "failing object(string)",
    input: { one: "one val", two: 1 },
    schema: object({
      one: string(),
      two: string(),
    }),
    expected: [pathOf("two")],
  },
  // record
  {
    description: "basic record(string)",
    input: { one: "one val", two: "two val" },
    schema: record(string()),
    expected: false,
  },
  {
    description: "failing record(string)",
    input: { one: "one val", two: 1 },
    schema: object({
      one: string(),
      two: string(),
    }),
    expected: [pathOf("two")],
  },
  {
    description: "basic keyOf(record)",
    input: "one",
    schema: keyOf(define("/keyof-module", record(string()), { one: "" })),
    expected: [testPath],
    fixes: {
      [testPath]: ["keyof:check-keys"],
    },
  },
  {
    description: "failing keyOf(record)",
    input: 1,
    schema: keyOf(define("/keyof-module", record(string()), {})),
    expected: [testPath],
  },
  {
    description: "basic keyOf(object)",
    input: "test1",
    schema: keyOf(
      define("/keyof-module", object({ test1: string(), test2: string() }), {
        test1: "",
        test2: "",
      }),
    ),
    expected: false,
  },
  {
    description: "failing keyOf(object)",
    input: "test",
    schema: keyOf(
      define("/keyof-module", object({ test1: string(), test2: string() }), {
        test1: "",
        test2: "",
      }),
    ),
    expected: [testPath],
  },
  // image / file
  {
    description: "nullable image",
    input: null,
    schema: image().nullable(),
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
    input: fileVal("/public/val/test.png", {
      width: 100,
      height: 100,
    }),
    schema: image(),
    expected: [testPath],
    fixes: {
      [testPath]: ["image:check-metadata"],
    },
  },
  {
    description: "failure image: check metadata",
    input: fileVal("/public/val/test.png", {
      width: 100,
      height: 100,
    }),
    schema: image(),
    expected: [testPath],
    fixes: {
      [testPath]: ["image:check-metadata"],
    },
  },
  // richtext
  {
    description: "basic richtext",
    input: [{ tag: "p", children: ["test"] }],
    expected: false,
    schema: richtext({ style: { bold: true } }),
  },
  // TODO: more richtext cases
  {
    description: "basic union literals: key",
    input: "one",
    schema: union(literal("one"), literal("two"), literal("three")),
    expected: false,
  },
  {
    description: "basic union literals: item",
    input: "three",
    schema: union(literal("one"), literal("two"), literal("three")),
    expected: false,
  },
  {
    description: "failing union literals",
    input: "four",
    schema: union(literal("one"), literal("two"), literal("three")),
    expected: [testPath],
  },
  {
    description: "basic tagged union",
    input: {
      type: "singleItem",
      text: "test",
    },
    schema: union(
      "type",
      object({ type: literal("singleItem"), text: string() }),
      object({
        type: literal("multiItem"),
        items: array(object({ type: literal("singleItem"), text: string() })),
      }),
    ),
    expected: false,
  },
  {
    description: "failing tagged union: 1",
    input: {
      type: "multiItem",
      text: "test",
    },
    schema: union(
      "type",
      object({ type: literal("singleItem"), text: string() }),
      object({
        type: literal("multiItem"),
        items: array(string()),
      }),
    ),
    expected: [pathOf("items")],
  },
  {
    description: "failing tagged union: 2",
    input: {
      type: "multiItem",
      items: { test: "subItem2", text2: "" },
    },
    schema: union(
      "type",
      object({ type: literal("singleItem"), text: string() }),
      object({
        type: literal("multiItem"),
        items: union(
          "test",
          object({ test: literal("subItem1"), text1: string() }),
          object({ test: literal("subItem2"), text2: string().minLength(2) }),
        ),
      }),
    ),
    expected: [createValPathOfItem(pathOf("items"), "text2")],
  },
  {
    description: "failing tagged union: 3",
    input: {
      type: "multiItem",
      items: { test: "subItem1", text2: "" },
    },
    schema: union(
      "type",
      object({ type: literal("duplicateItem"), text: string() }),
      object({
        type: literal("duplicateItem"),
        text2: string(),
      }),
    ),
    expected: [testPath],
  },
  {
    description: "failing tagged union: 4",
    input: {
      type: "foobar",
      items: { test: "subItem1", text2: "" },
    },
    schema: union(
      "type",
      object({ type: literal("test1"), text: string() }),
      object({
        type: literal("test2"),
        text2: string(),
      }),
    ),
    expected: [pathOf("type")],
  },

  {
    description: "failing tagged union: 5",
    input: {
      type: "test2",
      image: fileVal("/public/val/test.png"),
    },
    schema: union(
      "type",
      object({ type: literal("test1"), text: string() }),
      object({
        type: literal("test2"),
        image: image(),
      }),
    ),
    expected: [pathOf("image")],
    fixes: {
      [pathOf("image") as string]: ["image:add-metadata"],
    },
  },
  {
    description: "date validation: base case",
    input: "2021-01-01",
    schema: date(),
    expected: false,
  },
  {
    description: "date validation: from error",
    input: "2020-01-01",
    schema: date().from("2021-01-01"),
    expected: [testPath],
  },
  {
    description: "date validation: to error",
    input: "2021-01-01",
    schema: date().to("2019-12-31"),
    expected: [testPath],
  },
  {
    description: "date validation: between",
    input: "2021-01-01",
    schema: date().from("2020-01-01").to("2023-12-31"),
    expected: false,
  },
  {
    description: "date validation: between error",
    input: "2021-01-01",
    schema: date().from("2022-01-01").to("2022-12-31"),
    expected: [testPath],
  },
  {
    description: "date validation: from / to is not valid in schema error",
    input: "2021-01-01",
    schema: date().from("2022-01-01").to("2019-12-31"),
    expected: [testPath],
  },

  // svg
  {
    description: "basic svg",
    input: {
      viewBox: "0 0 24 24",
      width: 24,
      height: 24,
      children: [
        {
          tag: "path",
          attrs: { d: "M4 12h16", stroke: { var: "line" }, fill: "none" },
          children: [],
        },
      ],
    },
    schema: svg({ variables: { brand: "#0055ff", line: "currentColor" } }),
    expected: false,
  },
  {
    description: "svg with an unsupported tag",
    input: {
      viewBox: "0 0 24 24",
      width: null,
      height: null,
      children: [{ tag: "script", attrs: {}, children: [] }],
    },
    schema: svg(),
    expected: [subPathOf("children", ".0." + '"tag"')],
  },
  {
    description: "svg with an event handler attribute",
    input: {
      viewBox: "0 0 24 24",
      width: null,
      height: null,
      children: [
        { tag: "circle", attrs: { onload: "alert(1)" }, children: [] },
      ],
    },
    schema: svg(),
    expected: [subPathOf("children", ".0." + '"attrs"."onload"')],
  },
  {
    description: "svg with an attribute that is not valid on that tag",
    input: {
      viewBox: "0 0 24 24",
      width: null,
      height: null,
      children: [{ tag: "circle", attrs: { d: "M0 0" }, children: [] }],
    },
    schema: svg(),
    expected: [subPathOf("children", ".0." + '"attrs"."d"')],
  },
  {
    description: "svg with a raw color, literals forbidden (default)",
    input: {
      viewBox: "0 0 24 24",
      width: null,
      height: null,
      children: [{ tag: "circle", attrs: { fill: "#ff0000" }, children: [] }],
    },
    schema: svg({ variables: { brand: "#0055ff" } }),
    expected: [subPathOf("children", ".0." + '"attrs"."fill"')],
  },
  {
    description: "svg with a raw color that is in the literals allowlist",
    input: {
      viewBox: "0 0 24 24",
      width: null,
      height: null,
      children: [{ tag: "circle", attrs: { fill: "#000000" }, children: [] }],
    },
    schema: svg({ variables: {}, literals: ["#000000"] }),
    expected: false,
  },
  {
    description: "svg with a raw color that is not in the literals allowlist",
    input: {
      viewBox: "0 0 24 24",
      width: null,
      height: null,
      children: [{ tag: "circle", attrs: { fill: "#ff0000" }, children: [] }],
    },
    schema: svg({ variables: {}, literals: ["#000000"] }),
    expected: [subPathOf("children", ".0." + '"attrs"."fill"')],
  },
  {
    description: "svg with any raw color, literals allowed",
    input: {
      viewBox: "0 0 24 24",
      width: null,
      height: null,
      children: [{ tag: "circle", attrs: { fill: "#ff0000" }, children: [] }],
    },
    schema: svg({ variables: {}, literals: "allow" }),
    expected: false,
  },
  {
    description: "svg referencing a variable that is not declared",
    input: {
      viewBox: "0 0 24 24",
      width: null,
      height: null,
      children: [
        { tag: "circle", attrs: { fill: { var: "nope" } }, children: [] },
      ],
    },
    schema: svg({ variables: { brand: "#0055ff" } }),
    expected: [subPathOf("children", ".0." + '"attrs"."fill"')],
  },
  {
    description: "svg with the always allowed color keywords",
    input: {
      viewBox: "0 0 24 24",
      width: null,
      height: null,
      children: [
        {
          tag: "circle",
          attrs: { fill: "none", stroke: "currentColor" },
          children: [],
        },
      ],
    },
    schema: svg(),
    expected: false,
  },
  {
    description: "svg with a malformed viewBox",
    input: {
      viewBox: "0 0 24",
      width: null,
      height: null,
      children: [],
    },
    schema: svg(),
    expected: [pathOf("viewBox")],
  },
  {
    description: "svg with a viewBox that violates an exact width",
    input: {
      viewBox: "0 0 32 24",
      width: null,
      height: null,
      children: [],
    },
    schema: svg({ width: 24 }),
    expected: [pathOf("viewBox")],
  },
  {
    description: "svg with a viewBox outside a min / max range",
    input: {
      viewBox: "0 0 128 128",
      width: null,
      height: null,
      children: [],
    },
    schema: svg({ width: { min: 16, max: 64 } }),
    expected: [pathOf("viewBox")],
  },
  {
    description: "svg with the wrong aspect ratio",
    input: {
      viewBox: "0 0 32 24",
      width: null,
      height: null,
      children: [],
    },
    schema: svg({ aspectRatio: "1:1" }),
    expected: [pathOf("viewBox")],
  },
  {
    description: "svg with a float viewBox that is within the ratio epsilon",
    input: {
      viewBox: "0 0 23.99999 24",
      width: null,
      height: null,
      children: [],
    },
    schema: svg({ aspectRatio: 1 }),
    expected: false,
  },
  {
    description: "svg where width contradicts a satisfied viewBox",
    input: {
      viewBox: "0 0 24 24",
      width: 100,
      height: 24,
      children: [],
    },
    schema: svg({ width: 24 }),
    expected: [pathOf("width")],
  },
  {
    description: "svg with too many nodes",
    input: {
      viewBox: "0 0 24 24",
      width: null,
      height: null,
      children: [
        { tag: "circle", attrs: {}, children: [] },
        { tag: "circle", attrs: {}, children: [] },
        { tag: "circle", attrs: {}, children: [] },
      ],
    },
    schema: svg({ maxNodes: 2 }),
    expected: [testPath],
  },
  {
    description: "svg nested too deeply",
    input: {
      viewBox: "0 0 24 24",
      width: null,
      height: null,
      children: [
        {
          tag: "g",
          attrs: {},
          children: [
            {
              tag: "g",
              attrs: {},
              children: [{ tag: "g", attrs: {}, children: [] }],
            },
          ],
        },
      ],
    },
    schema: svg({ maxDepth: 2 }),
    expected: [subPathOf("children", ".0." + '"children".0."children".0')],
  },
  {
    description: "svg is null",
    input: null,
    schema: svg(),
    expected: [testPath],
  },
  {
    description: "nullable svg is null",
    input: null,
    schema: svg().nullable(),
    expected: false,
  },

  // TODO: oneOf
  // TODO: i18n
];

describe("validation", () => {
  test.each(ValidationTestCases)(
    'validate ($description): "$expected"',
    ({ input, schema, expected, fixes }) => {
      const result = schema["executeValidate"](testPath, input);
      if (result) {
        expect(Object.keys(result)).toStrictEqual(expected);
        if (fixes) {
          expect(
            Object.fromEntries(
              Object.entries(result as ValidationErrors).map(
                ([path, errors]) => [
                  path,
                  errors.flatMap((error: ValidationError) => error.fixes),
                ],
              ),
            ),
          ).toStrictEqual(fixes);
        }
      } else {
        expect(result).toStrictEqual(expected);
      }
    },
  );
});
