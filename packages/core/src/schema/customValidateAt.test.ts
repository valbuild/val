import { SourcePath } from "../val";
import { array } from "./array";
import { number } from "./number";
import { object } from "./object";
import { record } from "./record";
import { string } from "./string";

/**
 * `executeCustomValidateAt` runs ONE node's user-supplied validators, which is
 * what lets the Studio split validation in two: structural errors come from a
 * worker holding a deserialized schema (where user functions cannot survive),
 * and these are executed on the main thread against the real schema instance.
 */
describe("executeCustomValidateAt", () => {
  const path = '/test.val.ts?p="title"' as SourcePath;

  test("runs this node's validators and reports the failure message", () => {
    const schema = string().validate((src) =>
      src.startsWith("A") ? false : "must start with A",
    );
    expect(schema["executeCustomValidateAt"](path, "Apple")).toEqual([]);
    expect(schema["executeCustomValidateAt"](path, "Banana")).toEqual([
      { message: "must start with A", value: "Banana" },
    ]);
  });

  test("a node with no validators returns nothing (the common case)", () => {
    expect(string()["executeCustomValidateAt"](path, "anything")).toEqual([]);
    expect(number()["executeCustomValidateAt"](path, 1)).toEqual([]);
  });

  test("runs only THIS node's validators, not its children's", () => {
    // The caller walks the tree and calls this per flagged node, so a node that
    // also recursed into its children would report the same error twice.
    const schema = object({
      title: string().validate(() => "child says no"),
    }).validate(() => "parent says no");

    expect(schema["executeCustomValidateAt"](path, { title: "x" })).toEqual([
      { message: "parent says no", value: { title: "x" } },
    ]);
  });

  test("a throwing validator is a schemaError, not an exception", () => {
    const schema = string().validate(() => {
      throw new Error("validator blew up");
    });
    expect(schema["executeCustomValidateAt"](path, "x")).toEqual([
      {
        message: "Error in custom validate function: validator blew up",
        value: "x",
        schemaError: true,
      },
    ]);
  });

  test("works on containers, including a .jsonValues() record", () => {
    // A record-level validator sees the whole record — which for jsonValues means
    // it needs every entry loaded first. That is the caller's needs-keys problem;
    // here we only pin that the validator itself runs on the node.
    const schema = record(object({ title: string() }))
      .jsonValues()
      .validate((src) =>
        Object.keys(src ?? {}).length > 1 ? "at most one entry" : false,
      );
    const modulePath = "/test.val.ts" as SourcePath;
    expect(
      schema["executeCustomValidateAt"](modulePath, {
        a: { title: "A" },
      } as never),
    ).toEqual([]);
    expect(
      schema["executeCustomValidateAt"](modulePath, {
        a: { title: "A" },
        b: { title: "B" },
      } as never),
    ).toEqual([
      {
        message: "at most one entry",
        value: { a: { title: "A" }, b: { title: "B" } },
      },
    ]);
  });

  test("array nodes too", () => {
    const schema = array(string()).validate((src) =>
      src.length === 0 ? "must not be empty" : false,
    );
    expect(schema["executeCustomValidateAt"](path, [])).toEqual([
      { message: "must not be empty", value: [] },
    ]);
    expect(schema["executeCustomValidateAt"](path, ["x"])).toEqual([]);
  });
});
