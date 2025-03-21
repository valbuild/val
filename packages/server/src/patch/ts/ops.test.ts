import ts from "typescript";
import { TSOps } from "./ops";
import { result, array, pipe } from "@valbuild/core/fp";
import { PatchError, JSONValue } from "@valbuild/core/patch";
import { ValSyntaxError } from "./syntax";
import type { RemoteSource } from "@valbuild/core/src/source/remote";

function testSourceFile(expression: string): ts.SourceFile {
  return ts.createSourceFile(
    "test.ts",
    `(${expression})`,
    ts.ScriptTarget.ES2020,
    true,
  );
}

/**
 * This function throws instead of returning Err because a malformed source
 * would be an issue with the test data.
 */
function findRoot(
  sourceFile: ts.SourceFile,
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
    {
      name: "c.file",
      input: `{ foo: "bar" }`,
      path: ["image"],
      value: { _ref: "/public/val/image.jpg", _type: "file" },
      expected: result.ok(
        `{ foo: "bar", image: c.file("/public/val/image.jpg") }`,
      ),
    },
    {
      name: "ref prop to c.file",
      input: `c.file("/public/val/foo.jpg")`,
      path: ["_ref"],
      value: "/public/val/bar.jpg",
      expected: result.ok(`c.file("/public/val/bar.jpg")`),
    },
    {
      name: "ref prop to c.remote",
      input: `c.remote("val://<schema>/<hash>/public/val/foo.jpg")`,
      path: ["_ref"],
      value: "val://<schema>/<hash>/public/val/bar.jpg",
      expected: result.ok(
        `c.remote("val://<schema>/<hash>/public/val/bar.jpg")`,
      ),
    },
    {
      name: "ref prop",
      input: `{ foo: "bar", image: {} }`,
      path: ["image", "_ref"],
      value: "/public/val/image.jpg",
      expected: result.err(PatchError),
    },
    {
      name: "prop on c.file",
      input: `{ foo: "bar", image: c.file("/public/val/image.jpg") }`,
      path: ["image", "metadata"],
      value: {
        width: 123,
        height: 456,
      },
      expected: result.ok(
        `{ foo: "bar", image: c.file("/public/val/image.jpg", { width: 123, height: 456 }) }`,
      ),
    },
    {
      name: "null prop of name ref on c.file",
      input: `{ foo: "bar", image: c.file("/public/val/image.jpg") }`,
      path: ["image", "_ref"],
      value: null,
      expected: result.err(PatchError),
    },
    {
      name: "to ref on c.file",
      input: `{ foo: "bar", image: c.file("/public/val/image.jpg") }`,
      path: ["image", "_ref", "zoo"],
      value: null,
      expected: result.err(PatchError),
    },
  ])("add $name", ({ input, path, value, expected }) => {
    const src = testSourceFile(input);
    const ops = new TSOps(findRoot);
    expect(ops.add(src, path, value)).toEqual(
      pipe(
        expected,
        result.map(testSourceFile),
        result.mapErr((errorType) => expect.any(errorType)),
      ),
    );
  });

  test.each<{
    name: string;
    input: string;
    path: array.NonEmptyArray<string>;
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
    {
      name: "c.file from array",
      input: `[c.file("/public/val/image1.jpg"), c.file("/public/val/image2.jpg")]`,
      path: ["0"],
      expected: result.ok(`[c.file("/public/val/image2.jpg")]`),
    },
    {
      name: "c.remote from array",
      input: `[c.remote("val://<schema>/<hash>/public/val/image1.jpg"), c.remote("val://<schema>/<hash>/public/val/image2.jpg")]`,
      path: ["0"],
      expected: result.ok(
        `[c.remote("val://<schema>/<hash>/public/val/image2.jpg")]`,
      ),
    },
    {
      name: "c.file from object",
      input: `[{ foo: "bar", image: c.file("/public/val/image.jpg") }]`,
      path: ["0", "image"],
      expected: result.ok(`[{ foo: "bar" }]`),
    },
    {
      name: "ref prop from c.file",
      input: `{ image: c.file("/public/val/image.jpg") }`,
      path: ["image", "_ref"],
      expected: result.err(PatchError),
    },
  ])("remove $name", ({ input, path, expected }) => {
    const src = testSourceFile(input);
    const ops = new TSOps(findRoot);
    expect(ops.remove(src, path)).toEqual(
      pipe(
        expected,
        result.map(testSourceFile),
        result.mapErr((errorType) => expect.any(errorType)),
      ),
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
    {
      name: "c.files",
      input: `c.file("/public/val/foo/bar.jpg")`,
      path: ["_ref"],
      value: "/public/val/foo/bar2.jpg",
      expected: result.ok(`c.file("/public/val/foo/bar2.jpg")`),
    },
    {
      name: "c.file ref with options",
      input: `c.file("/public/val/foo/bar.jpg", { checksum: "123", width: 456, height: 789 })`,
      path: ["_ref"],
      value: "/public/val/foo/bar2.jpg",
      expected: result.ok(
        `c.file("/public/val/foo/bar2.jpg", { checksum: "123", width: 456, height: 789 })`,
      ),
    },
    // TODO:
    // {
    //   name: "c.file non metadata",
    //   input: `c.file("/public/val/foo/bar.jpg", { checksum: "123", width: 456, height: 789 })`,
    //   path: ["failure", "checksum"],
    //   value: "101112",
    //   expected: result.err(PatchError),
    // },
    {
      name: "c.file checksum",
      input: `c.file("/public/val/foo/bar.jpg", { checksum: "123", width: 456, height: 789 })`,
      path: ["metadata", "checksum"],
      value: "101112",
      expected: result.ok(
        `c.file("/public/val/foo/bar.jpg", { checksum: "101112", width: 456, height: 789 })`,
      ),
    },
    {
      name: "deep c.files",
      input: `{ foo: { bar: c.file("/public/val/foo/bar/zoo.jpg") } }`,
      path: ["foo", "bar", "_ref"],
      value: "/public/val/foo/bar/zoo2.jpg",
      expected: result.ok(
        `{ foo: { bar: c.file("/public/val/foo/bar/zoo2.jpg") } }`,
      ),
    },
    {
      name: "prop on c.file",
      input: `{ foo: "bar", image: c.file("/public/val/image.jpg") }`,
      path: ["image", "metadata"],
      value: {
        width: 123,
        height: 456,
      },
      expected: result.err(PatchError),
    },
    {
      name: "null prop of name ref on c.file",
      input: `{ foo: "bar", image: c.file("/public/val/image.jpg") }`,
      path: ["image", "_ref"],
      value: null,
      expected: result.err(PatchError),
    },
    {
      name: "number prop of name ref on c.file",
      input: `{ foo: "bar", image: c.file("/public/val/image.jpg") }`,
      path: ["image", "_ref"],
      value: 1,
      expected: result.err(PatchError),
    },
    {
      name: "to ref on c.file",
      input: `{ foo: "bar", image: c.file("/public/val/image.jpg") }`,
      path: ["image", "_ref", "zoo"],
      value: null,
      expected: result.err(PatchError),
    },
    {
      name: "c.file with c.remote",
      input: `c.file("/public/val/foo/bar.jpg")`,
      path: [],
      value: {
        _ref: "val://<schema>/<hash>/public/val/foo/bar.jpg",
        _type: "remote",
      } satisfies RemoteSource,
      expected: result.ok(
        `c.remote("val://<schema>/<hash>/public/val/foo/bar.jpg")`,
      ),
    },
    {
      name: "c.image with c.remote",
      input: `c.image("/public/val/foo/bar.jpg")`,
      path: [],
      value: {
        _ref: "val://<schema>/<hash>/public/val/foo/bar.jpg",
        _type: "remote",
      } satisfies RemoteSource,
      expected: result.ok(
        `c.remote("val://<schema>/<hash>/public/val/foo/bar.jpg")`,
      ),
    },
    {
      name: "c.file with metadata with c.remote",
      input: `c.file("/public/val/foo/bar.jpg", { checksum: "123", width: 456, height: 789 })`,
      path: [],
      value: {
        _ref: "val://<schema>/<hash>/public/val/foo/bar.jpg",
        _type: "remote",
        metadata: {
          checksum: "123",
          width: 456,
          height: 789,
        },
      } satisfies RemoteSource,
      expected: result.ok(
        `c.remote("val://<schema>/<hash>/public/val/foo/bar.jpg", { checksum: "123", width: 456, height: 789 })`,
      ),
    },
  ])("replace $name", ({ input, path, value, expected }) => {
    const src = testSourceFile(input);
    const ops = new TSOps(findRoot);
    expect(ops.replace(src, path, value)).toEqual(
      pipe(
        expected,
        result.map(testSourceFile),
        result.mapErr((errorType) => expect.any(errorType)),
      ),
    );
  });

  test.each<{
    name: string;
    input: string;
    from: array.NonEmptyArray<string>;
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
    {
      name: "c.file to root of document",
      input: `{ foo: null, baz: c.file("/public/val/foo/bar.jpg") }`,
      from: ["baz"],
      path: ["bar"],
      expected: result.ok(
        `{ foo: null, bar: c.file("/public/val/foo/bar.jpg") }`,
      ),
    },
    {
      name: "ref out of c.file",
      input: `{ foo: null, baz: c.file("/public/val/foo/bar.jpg") }`,
      from: ["baz", "_ref"],
      path: ["bar"],
      expected: result.err(PatchError),
    },
    {
      name: "object into c.file",
      input: `{ foo: { bar: "zoo" }, baz: c.file("/public/val/foo/bar.jpg") }`,
      from: ["foo"],
      path: ["baz", "metadata"],
      expected: result.ok(
        `{ baz: c.file("/public/val/foo/bar.jpg", { bar: "zoo" }) }`,
      ),
    },
    {
      name: "object into c.remote",
      input: `{ foo: { bar: "zoo" }, baz: c.remote("val://<schema>/<hash>/public/val/foo/bar.jpg") }`,
      from: ["foo"],
      path: ["baz", "metadata"],
      expected: result.ok(
        `{ baz: c.remote("val://<schema>/<hash>/public/val/foo/bar.jpg", { bar: "zoo" }) }`,
      ),
    },
  ])("move $name", ({ input, from, path, expected }) => {
    const src = testSourceFile(input);
    const ops = new TSOps(findRoot);
    expect(ops.move(src, from, path)).toEqual(
      pipe(
        expected,
        result.map(testSourceFile),
        result.mapErr((errorType) => expect.any(errorType)),
      ),
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
    {
      name: "c.file to root of object",
      input: `{ foo: c.file("/public/val/image1.jpg") }`,
      from: ["foo"],
      path: [],
      expected: result.ok(`c.file("/public/val/image1.jpg")`),
    },
    {
      name: "object into c.file",
      input: `{ foo: c.file("/public/val/image1.jpg"), bar: null }`,
      from: ["bar"],
      path: ["foo", "metadata"],
      expected: result.ok(
        `{ foo: c.file("/public/val/image1.jpg", null), bar: null }`,
      ),
    },
    {
      name: "object into c.file",
      input: `{ foo: c.remote("val://<schema>/<hash>/public/val/image1.jpg"), bar: null }`,
      from: ["bar"],
      path: ["foo", "metadata"],
      expected: result.ok(
        `{ foo: c.remote("val://<schema>/<hash>/public/val/image1.jpg", null), bar: null }`,
      ),
    },
  ])("copy $name", ({ input, from, path, expected }) => {
    const src = testSourceFile(input);
    const ops = new TSOps(findRoot);
    expect(ops.copy(src, from, path)).toEqual(
      pipe(expected, result.map(testSourceFile), result.mapErr(expect.any)),
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
    {
      name: "c.file ref",
      input: `c.file("/public/val/foo/bar.jpg")`,
      path: ["_ref"],
      value: "/public/val/foo/bar.jpg",
      expected: result.ok(true),
    },
    {
      name: "c.file",
      input: `c.file("/public/val/foo/bar.jpg")`,
      path: [],
      value: { _ref: "/public/val/foo/bar.jpg", _type: "file" },
      expected: result.ok(true),
    },
    {
      name: "c.remote",
      input: `c.remote("val://<schema>/<hash>/public/val/foo/bar.jpg")`,
      path: [],
      value: {
        _ref: "val://<schema>/<hash>/public/val/foo/bar.jpg",
        _type: "remote",
      },
      expected: result.ok(true),
    },
    {
      name: "nested c.file",
      input: `{ foo: { bar: c.file("/public/val/foo/bar/zoo.jpg") } }`,
      path: ["foo", "bar", "_ref"],
      value: "/public/val/foo/bar/zoo.jpg",
      expected: result.ok(true),
    },
  ])("test $name", ({ input, path, value, expected }) => {
    const src = testSourceFile(input);
    const ops = new TSOps(findRoot);
    expect(ops.test(src, path, value)).toEqual(
      pipe(expected, result.mapErr(expect.any)),
    );
  });
});
