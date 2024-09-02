import {
  formatJSONPointer,
  parseJSONPointer,
  parseOperation,
  StaticPatchIssue,
} from "./parse";
import * as result from "../fp/result";
import { Operation, OperationJSON } from "./operation";
import { array } from "../fp";

describe("parseOperation", () => {
  test.each<{
    name: string;
    value: OperationJSON;
    expected: Operation;
  }>([
    {
      name: "basic add operation",
      value: {
        op: "add",
        path: "/",
        value: null,
      },
      expected: {
        op: "add",
        path: [],
        value: null,
      },
    },
    {
      name: "basic remove operation",
      value: {
        op: "remove",
        path: "/foo",
      },
      expected: {
        op: "remove",
        path: ["foo"],
      },
    },
    {
      name: "basic replace operation",
      value: {
        op: "replace",
        path: "/",
        value: null,
      },
      expected: {
        op: "replace",
        path: [],
        value: null,
      },
    },
    {
      name: "basic move operation",
      value: {
        op: "move",
        from: "/foo",
        path: "/bar",
      },
      expected: {
        op: "move",
        from: ["foo"],
        path: ["bar"],
      },
    },
    {
      name: "basic copy operation",
      value: {
        op: "copy",
        from: "/foo",
        path: "/bar",
      },
      expected: {
        op: "copy",
        from: ["foo"],
        path: ["bar"],
      },
    },
    {
      name: "basic test operation",
      value: {
        op: "test",
        path: "/",
        value: null,
      },
      expected: {
        op: "test",
        path: [],
        value: null,
      },
    },
  ])("$name is valid", ({ value, expected }) => {
    const res = parseOperation(value);
    expect(res).toEqual(result.ok(expected));
  });

  test.each<{
    name: string;
    value: OperationJSON;
    errors: array.NonEmptyArray<string[]>;
  }>([
    {
      name: "add operation with empty path",
      value: {
        op: "add",
        path: "",
        value: null,
      },
      errors: [["path"]],
    },
    {
      name: "remove root",
      value: {
        op: "remove",
        path: "/",
      },
      errors: [["path"]],
    },
    {
      name: "move from root",
      value: {
        op: "move",
        from: "/",
        path: "/",
      },
      errors: [["from"]],
    },
    {
      name: "move from prefix of path",
      value: {
        op: "move",
        from: "/foo",
        path: "/foo/bar",
      },
      errors: [["from"]],
    },
  ])("$name is invalid", ({ value, errors }) => {
    expect(parseOperation(value)).toEqual(
      result.err(
        expect.arrayContaining<array.NonEmptyArray<StaticPatchIssue>>(
          errors.map((path) =>
            expect.objectContaining<StaticPatchIssue>({
              path,
              message: expect.anything(),
            }),
          ),
        ),
      ),
    );
  });
});

const JSONPointerTestCases: { str: string; arr: string[] }[] = [
  {
    str: "/",
    arr: [],
  },
  {
    str: "/foo",
    arr: ["foo"],
  },
  {
    str: "/foo/",
    arr: ["foo", ""],
  },
  {
    str: "/~1",
    arr: ["/"],
  },
  {
    str: "/~1/~1",
    arr: ["/", "/"],
  },
  {
    str: "/~0",
    arr: ["~"],
  },
  {
    str: "/~0/~0",
    arr: ["~", "~"],
  },
];

describe("parseJSONPointer", () => {
  test.each(JSONPointerTestCases)("valid: $str", ({ str, arr }) => {
    expect(parseJSONPointer(str)).toEqual(result.ok(arr));
  });

  test.each(["", "foo", "foo/bar", "/~2", "/~"])(
    "invalid: %s",
    (path: string) => {
      expect(parseJSONPointer(path)).toEqual(result.err(expect.any(String)));
    },
  );
});

describe("formatJSONPointer", () => {
  test.each(JSONPointerTestCases)("$str", ({ str, arr }) => {
    expect(formatJSONPointer(arr)).toEqual(str);
  });
});
