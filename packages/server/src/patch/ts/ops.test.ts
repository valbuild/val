import { describe, test, expect } from "@jest/globals";
import ts from "typescript";
import { TSOps } from "./ops";
import * as result from "../../fp/result";
import { PatchError, JSONValue } from "../ops";
import { pipe } from "../../fp/util";
import { ValSyntaxError } from "./syntax";
import { NonEmptyArray } from "../../fp/array";

function testSourceFile(expression: string): ts.SourceFile {
  return ts.createSourceFile(
    "test.ts",
    `(${expression})`,
    ts.ScriptTarget.ES2020
  );
}

/**
 * This function throws instead of returning Err because a malformed source
 * would be an issue with the test data.
 */
function findRoot(
  sourceFile: ts.SourceFile
): result.Result<ts.Expression, never> {
  if (sourceFile.statements.length !== 1) {
    throw Error("Invalid test source file");
  }
  const [stmt] = sourceFile.statements;
  if (!ts.isExpressionStatement(stmt)) {
    throw Error("Invalid test source file");
  }
  const expr = stmt.expression;
  if (!ts.isParenthesizedExpression(expr)) {
    throw Error("Invalid test source file");
  }
  return result.ok(expr.expression);
}

describe("TSOps", () => {
  test.each<{
    name: string;
    input: string;
    path: string[];
    value: JSONValue;
    expected: result.Result<string, typeof PatchError | typeof ValSyntaxError>;
  }>([
    {
      name: "root of document",
      input: `{ foo: "bar" }`,
      path: [],
      value: null,
      expected: result.ok(`null`),
    },
    {
      name: "defined property to object",
      input: `{ foo: "bar" }`,
      path: ["foo"],
      value: null,
      expected: result.ok(`{ foo: null }`),
    },
    {
      name: "new property to object",
      input: `{ foo: "bar" }`,
      path: ["bar"],
      value: null,
      expected: result.ok(`{ foo: "bar", bar: null }`),
    },
    {
      name: "property to object that is not an identifier (empty string)",
      input: `{ foo: "bar" }`,
      path: [""],
      value: "foo",
      expected: result.ok(`{ foo: "bar", "": "foo" }`),
    },
    {
      name: "property to object that is not an identifier (strings with whitespace)",
      input: `{ foo: "bar" }`,
      path: ["foo and "],
      value: "foo",
      expected: result.ok(`{ foo: "bar", "foo and ": "foo" }`),
    },
    {
      name: "item to array followed by other items",
      input: `["foo", "bar"]`,
      path: ["0"],
      value: null,
      expected: result.ok(`[null, "foo", "bar"]`),
    },
    {
      name: "item to end of array",
      input: `["foo", "bar"]`,
      path: ["2"],
      value: null,
      expected: result.ok(`["foo", "bar", null]`),
    },
    {
      name: "item to end of array with dash",
      input: `["foo", "bar"]`,
      path: ["-"],
      value: null,
      expected: result.ok(`["foo", "bar", null]`),
    },
    {
      name: "item to array with invalid index",
      input: `["foo", "bar"]`,
      path: ["baz"],
      value: null,
      expected: result.err(PatchError),
    },
    {
      name: "item at index out of bounds of array",
      input: `["foo", "bar"]`,
      path: ["3"],
      value: null,
      expected: result.err(PatchError),
    },
    {
      name: "defined property to object nested within object",
      input: `{ foo: { bar: "baz" } }`,
      path: ["foo", "bar"],
      value: null,
      expected: result.ok(`{ foo: { bar: null } }`),
    },
    {
      name: "defined property to object nested within array",
      input: `[{ foo: "bar" }]`,
      path: ["0", "foo"],
      value: null,
      expected: result.ok(`[{ foo: null }]`),
    },
    {
      name: "to undefined object/array",
      input: `{ foo: "bar" }`,
      path: ["bar", "foo"],
      value: null,
      expected: result.err(PatchError),
    },
    {
      name: "to non-object/array",
      input: `0`,
      path: ["foo"],
      value: null,
      expected: result.err(PatchError),
    },
  ])("add $name", ({ input, path, value, expected }) => {
    const src = testSourceFile(input);
    const ops = new TSOps(findRoot);
    expect(
      pipe(
        ops.add(src, path, value),
        result.map((src) => src.text),
        result.mapErr((error) =>
          error instanceof PatchError ? PatchError : ValSyntaxError
        )
      )
    ).toEqual(
      pipe(
        expected,
        result.map(testSourceFile),
        result.map((src) => src.text)
      )
    );
  });

  test.each<{
    name: string;
    input: string;
    path: NonEmptyArray<string>;
    expected: result.Result<string, typeof PatchError | typeof ValSyntaxError>;
  }>([
    {
      name: "defined property from object",
      input: `{ foo: "bar", bar: "baz" }`,
      path: ["bar"],
      expected: result.ok(`{ foo: "bar" }`),
    },
    {
      name: "undefined property to object",
      input: `{ foo: "bar" }`,
      path: ["bar"],
      expected: result.err(PatchError),
    },
    {
      name: "existing item from array",
      input: `["foo", "bar"]`,
      path: ["0"],
      expected: result.ok(`["bar"]`),
    },
    {
      name: "item from end of array with dash",
      input: `["foo", "bar"]`,
      path: ["-"],
      expected: result.err(PatchError),
    },
    {
      name: "item at index out of bounds of array",
      input: `["foo", "bar"]`,
      path: ["2"],
      expected: result.err(PatchError),
    },
    {
      name: "item from array with invalid index",
      input: `["foo", "bar"]`,
      path: ["baz"],
      expected: result.err(PatchError),
    },
    {
      name: "defined property from object nested within object",
      input: `{ foo: { bar: "baz", baz: "bar" } }`,
      path: ["foo", "baz"],
      expected: result.ok(`{ foo: { bar: "baz" } }`),
    },
    {
      name: "defined property from object nested within array",
      input: `[{ foo: "bar", baz: "bar" }]`,
      path: ["0", "baz"],
      expected: result.ok(`[{ foo: "bar" }]`),
    },
    {
      name: "from undefined object/array",
      input: `{ foo: "bar" }`,
      path: ["bar", "foo"],
      expected: result.err(PatchError),
    },
    {
      name: "from non-object/array",
      input: `0`,
      path: ["foo"],
      expected: result.err(PatchError),
    },
  ])("remove $name", ({ input, path, expected }) => {
    const src = testSourceFile(input);
    const ops = new TSOps(findRoot);
    expect(
      pipe(
        ops.remove(src, path),
        result.map((src) => src.text),
        result.mapErr((error) =>
          error instanceof PatchError ? PatchError : ValSyntaxError
        )
      )
    ).toEqual(
      pipe(
        expected,
        result.map(testSourceFile),
        result.map((src) => src.text)
      )
    );
  });

  test.each<{
    name: string;
    input: string;
    path: string[];
    value: JSONValue;
    expected: result.Result<string, typeof PatchError | typeof ValSyntaxError>;
  }>([
    {
      name: "root of document",
      input: `{ foo: "bar" }`,
      path: [],
      value: null,
      expected: result.ok(`null`),
    },
    {
      name: "defined property of object",
      input: `{ foo: "bar" }`,
      path: ["foo"],
      value: null,
      expected: result.ok(`{ foo: null }`),
    },
    {
      name: "undefined property of object",
      input: `{ foo: "bar" }`,
      path: ["bar"],
      value: null,
      expected: result.err(PatchError),
    },
    {
      name: "item of array",
      input: `["foo", "bar"]`,
      path: ["0"],
      value: null,
      expected: result.ok(`[null, "bar"]`),
    },
    {
      name: "item of array at invalid index",
      input: `["foo", "bar"]`,
      path: ["baz"],
      value: null,
      expected: result.err(PatchError),
    },
    {
      name: "item at index out of bounds of array",
      input: `["foo", "bar"]`,
      path: ["2"],
      value: null,
      expected: result.err(PatchError),
    },
    {
      name: "defined property of object nested within object",
      input: `{ foo: { bar: "baz" } }`,
      path: ["foo", "bar"],
      value: null,
      expected: result.ok(`{ foo: { bar: null } }`),
    },
    {
      name: "defined property of object nested within array",
      input: `[{ foo: "bar" }]`,
      path: ["0", "foo"],
      value: null,
      expected: result.ok(`[{ foo: null }]`),
    },
    {
      name: "from undefined object/array",
      input: `{ foo: "bar" }`,
      path: ["bar", "foo"],
      value: null,
      expected: result.err(PatchError),
    },
    {
      name: "from non-object/array",
      input: `0`,
      path: ["foo"],
      value: null,
      expected: result.err(PatchError),
    },
  ])("replace $name", ({ input, path, value, expected }) => {
    const src = testSourceFile(input);
    const ops = new TSOps(findRoot);
    expect(
      pipe(
        ops.replace(src, path, value),
        result.map((src) => src.text),
        result.mapErr((error) =>
          error instanceof PatchError ? PatchError : ValSyntaxError
        )
      )
    ).toEqual(
      pipe(
        expected,
        result.map(testSourceFile),
        result.map((src) => src.text)
      )
    );
  });

  test.each<{
    name: string;
    input: string;
    from: NonEmptyArray<string>;
    path: string[];
    expected: result.Result<string, typeof PatchError | typeof ValSyntaxError>;
  }>([
    {
      name: "value to root of document",
      input: `{ foo: "bar" }`,
      from: ["foo"],
      path: [],
      expected: result.ok(`"bar"`),
    },
    {
      name: "defined property to undefined property of object",
      input: `{ foo: null, baz: 1 }`,
      from: ["foo"],
      path: ["bar"],
      expected: result.ok(`{ baz: 1, bar: null }`),
    },
    {
      name: "defined property to defined property of object",
      input: `{ foo: null, bar: "baz" }`,
      from: ["foo"],
      path: ["bar"],
      expected: result.ok(`{ bar: null }`),
    },
    {
      name: "undefined property of object",
      input: `{ foo: "bar" }`,
      from: ["bar"],
      path: ["baz"],
      expected: result.err(PatchError),
    },
    {
      name: "item within array",
      input: `["foo", null]`,
      from: ["1"],
      path: ["0"],
      expected: result.ok(`[null, "foo"]`),
    },
    {
      name: "item to end of array with dash",
      input: `[null, "foo"]`,
      from: ["0"],
      path: ["-"],
      expected: result.ok(`["foo", null]`),
    },
    {
      name: "item from invalid index of array",
      input: `["foo", "bar"]`,
      from: ["foo"],
      path: ["0"],
      expected: result.err(PatchError),
    },
    {
      name: "item to invalid index of array",
      input: `["foo", "bar"]`,
      from: ["1"],
      path: ["foo"],
      expected: result.err(PatchError),
    },
    {
      name: "item from index out of bounds of array",
      input: `["foo", "bar"]`,
      from: ["2"],
      path: ["0"],
      expected: result.err(PatchError),
    },
    {
      name: "item to index out of bounds of array",
      input: `["foo", "bar"]`,
      from: ["0"],
      path: ["2"],
      expected: result.err(PatchError),
    },
  ])("move $name", ({ input, from, path, expected }) => {
    const src = testSourceFile(input);
    const ops = new TSOps(findRoot);
    expect(
      pipe(
        ops.move(src, from, path),
        result.map((src) => src.text),
        result.mapErr((error) =>
          error instanceof PatchError ? PatchError : ValSyntaxError
        )
      )
    ).toEqual(
      pipe(
        expected,
        result.map(testSourceFile),
        result.map((src) => src.text)
      )
    );
  });

  test.each<{
    name: string;
    input: string;
    from: string[];
    path: string[];
    expected: result.Result<string, typeof PatchError | typeof ValSyntaxError>;
  }>([
    {
      name: "object into itself",
      input: `{ foo: "bar" }`,
      from: [],
      path: ["foo"],
      expected: result.ok(`{ foo: { foo: "bar" } }`),
    },
    {
      name: "value to root of document",
      input: `{ foo: "bar" }`,
      from: ["foo"],
      path: [],
      expected: result.ok(`"bar"`),
    },
    {
      name: "defined property to undefined property of object",
      input: `{ foo: null, baz: 1 }`,
      from: ["foo"],
      path: ["bar"],
      expected: result.ok(`{ foo: null, baz: 1, bar: null }`),
    },
    {
      name: "defined property to defined property of object",
      input: `{ foo: null, bar: "baz" }`,
      from: ["foo"],
      path: ["bar"],
      expected: result.ok(`{ foo: null, bar: null }`),
    },
    {
      name: "undefined property of object",
      input: `{ foo: "bar" }`,
      from: ["bar"],
      path: ["baz"],
      expected: result.err(PatchError),
    },
    {
      name: "item within array",
      input: `["foo", null]`,
      from: ["1"],
      path: ["0"],
      expected: result.ok(`[null, "foo", null]`),
    },
    {
      name: "item to end of array with dash",
      input: `[null, "foo"]`,
      from: ["0"],
      path: ["-"],
      expected: result.ok(`[null, "foo", null]`),
    },
    {
      name: "item from invalid index of array",
      input: `["foo", "bar"]`,
      from: ["foo"],
      path: ["0"],
      expected: result.err(PatchError),
    },
    {
      name: "item to invalid index of array",
      input: `["foo", "bar"]`,
      from: ["1"],
      path: ["foo"],
      expected: result.err(PatchError),
    },
    {
      name: "item from index out of bounds of array",
      input: `["foo", "bar"]`,
      from: ["2"],
      path: ["0"],
      expected: result.err(PatchError),
    },
    {
      name: "item to index out of bounds of array",
      input: `["foo", "bar"]`,
      from: ["0"],
      path: ["3"],
      expected: result.err(PatchError),
    },
  ])("copy $name", ({ input, from, path, expected }) => {
    const src = testSourceFile(input);
    const ops = new TSOps(findRoot);
    expect(
      pipe(
        ops.copy(src, from, path),
        result.map((src) => src.text),
        result.mapErr((error) =>
          error instanceof PatchError ? PatchError : ValSyntaxError
        )
      )
    ).toEqual(
      pipe(
        expected,
        result.map(testSourceFile),
        result.map((src) => src.text)
      )
    );
  });

  test.each<{
    name: string;
    input: string;
    path: string[];
    value: JSONValue;
    expected: result.Result<boolean, typeof PatchError | typeof ValSyntaxError>;
  }>([
    {
      name: "object 1",
      input: `{ foo: "bar" }`,
      path: [],
      value: { foo: "bar" },
      expected: result.ok(true),
    },
    {
      name: "object 2",
      input: `{ foo: "bar" }`,
      path: [],
      value: null,
      expected: result.ok(false),
    },
    {
      name: "array 1",
      input: `["foo", "bar"]`,
      path: [],
      value: ["foo", "bar"],
      expected: result.ok(true),
    },
    {
      name: "array 2",
      input: `["foo", "bar"]`,
      path: [],
      value: ["bar", "foo"],
      expected: result.ok(false),
    },
    {
      name: "defined property from object",
      input: `{ foo: "bar", bar: "baz" }`,
      path: ["bar"],
      value: "baz",
      expected: result.ok(true),
    },
    {
      name: "undefined property of object",
      input: `{ foo: "bar" }`,
      path: ["bar"],
      value: null,
      expected: result.err(PatchError),
    },
    {
      name: "item from array",
      input: `["foo", "bar"]`,
      path: ["0"],
      value: "foo",
      expected: result.ok(true),
    },
    {
      name: "item from end of array with dash",
      input: `["foo", "bar"]`,
      path: ["-"],
      value: null,
      expected: result.err(PatchError),
    },
    {
      name: "item at index out of bounds of array",
      input: `["foo", "bar"]`,
      path: ["2"],
      value: null,
      expected: result.err(PatchError),
    },
    {
      name: "item from array with invalid index",
      input: `["foo", "bar"]`,
      path: ["baz"],
      value: null,
      expected: result.err(PatchError),
    },
    {
      name: "complex nested objects",
      input: `{ foo: { bar: "baz", baz: ["bar", { 0: 1}] } }`,
      path: [],
      value: { foo: { bar: "baz", baz: ["bar", { 0: 1 }] } },
      expected: result.ok(true),
    },
    {
      name: "at undefined object/array",
      input: `{ foo: "bar" }`,
      path: ["bar", "foo"],
      value: null,
      expected: result.err(PatchError),
    },
    {
      name: "escaped paths",
      input: `{ "foo/bar~/~": "baz" }`,
      path: ["foo/bar~/~"],
      value: "baz",
      expected: result.ok(true),
    },
    {
      name: "at non-object/array",
      input: `0`,
      path: ["foo"],
      value: null,
      expected: result.err(PatchError),
    },
  ])("test $name", ({ input, path, value, expected }) => {
    const src = testSourceFile(input);
    const ops = new TSOps(findRoot);
    expect(
      pipe(
        ops.test(src, path, value),
        result.mapErr((error) =>
          error instanceof PatchError ? PatchError : ValSyntaxError
        )
      )
    ).toEqual(expected);
  });
});
