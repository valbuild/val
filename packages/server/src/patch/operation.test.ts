import { formatJSONPath, validateOperation } from "./operation";
import { JSONValue } from "./ops";
import * as result from "../fp/result";
import { pipe } from "../fp/util";

describe("validateOperation", () => {
  test.each<{
    name: string;
    value: JSONValue;
  }>([
    {
      name: "basic add operation",
      value: {
        op: "add",
        path: "/",
        value: null,
      },
    },
    {
      name: "basic remove operation",
      value: {
        op: "remove",
        path: "/foo",
      },
    },
    {
      name: "basic replace operation",
      value: {
        op: "replace",
        path: "/",
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
    },
    {
      name: "basic copy operation",
      value: {
        op: "move",
        from: "/foo",
        path: "/bar",
      },
    },
    {
      name: "basic test operation",
      value: {
        op: "test",
        path: "/",
        value: null,
      },
    },
  ])("$name is valid", ({ value }) => {
    const res = validateOperation(value);
    expect(res).toEqual(result.voidOk);
  });

  test.each<{
    name: string;
    value: JSONValue;
    errors: Set<string>;
  }>([
    {
      name: "operation with no op",
      value: {
        path: "/",
        value: null,
      },
      errors: new Set(["/op"]),
    },
    {
      name: "operation with unknown op",
      value: {
        op: "foo",
        path: "/",
        value: null,
      },
      errors: new Set(["/op"]),
    },
    {
      name: "add operation with no path",
      value: {
        op: "add",
        value: null,
      },
      errors: new Set(["/path"]),
    },
    {
      name: "add operation with empty path",
      value: {
        op: "add",
        path: "",
        value: null,
      },
      errors: new Set(["/path"]),
    },
    {
      name: "add operation with no path or value",
      value: {
        op: "add",
      },
      errors: new Set(["/path", "/value"]),
    },
    {
      name: "remove root",
      value: {
        op: "remove",
        path: "/",
      },
      errors: new Set(["/path"]),
    },
    {
      name: "move from root",
      value: {
        op: "move",
        from: "/",
        path: "/",
      },
      errors: new Set(["/from"]),
    },
    {
      name: "move from prefix of path",
      value: {
        op: "move",
        from: "/foo",
        path: "/foo/bar",
      },
      errors: new Set(["/from"]),
    },
  ])("$name is invalid", ({ value, errors }) => {
    const res = validateOperation(value);
    expect(
      pipe(
        res,
        result.mapErr(
          (errors) => new Set(errors.map(({ path }) => formatJSONPath(path)))
        )
      )
    ).toEqual(result.err(errors));
  });
});
