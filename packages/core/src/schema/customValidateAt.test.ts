import { SourcePath } from "../val";
import { array } from "./array";
import { number } from "./number";
import { object } from "./object";
import { literal } from "./literal";
import { record } from "./record";
import { string } from "./string";
import { union } from "./union";

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

  describe("tagged union", () => {
    // A union's variants SHARE the union's path, so the caller's `resolvePath`
    // stops at the union and never reaches the variant. The union is the only node
    // that knows which variant a value takes, so it has to dispatch itself — the
    // one place where "only THIS node's validators" cannot hold.
    const taggedUnion = union(
      "type",
      object({
        type: literal("a"),
        n: number().validate((src) => (src > 0 ? false : "n must be positive")),
      }).validate((src) => (src.n === 13 ? "13 is unlucky" : false)),
      object({ type: literal("b"), s: string() }).validate(
        () => "b is never valid",
      ),
    );

    test("runs the MATCHED variant's own validator", () => {
      expect(
        taggedUnion["executeCustomValidateAt"](path, { type: "a", n: 13 }),
      ).toEqual([{ message: "13 is unlucky", value: { type: "a", n: 13 } }]);
    });

    test("does NOT run the other variants' validators", () => {
      expect(
        taggedUnion["executeCustomValidateAt"](path, { type: "a", n: 1 }),
      ).toEqual([]);
      expect(
        taggedUnion["executeCustomValidateAt"](path, { type: "b", s: "x" }),
      ).toEqual([
        { message: "b is never valid", value: { type: "b", s: "x" } },
      ]);
    });

    test("still only THIS node: the variant's CHILD validators are the caller's job", () => {
      // `n` gets its own path, so the walk flags it separately.
      expect(
        taggedUnion["executeCustomValidateAt"](path, { type: "a", n: -1 }),
      ).toEqual([]);
    });

    test("the union's own validator runs alongside the variant's", () => {
      const withBoth = union(
        "type",
        object({ type: literal("a") }).validate(() => "variant says no"),
      ).validate(() => "union says no");
      expect(withBoth["executeCustomValidateAt"](path, { type: "a" })).toEqual([
        { message: "union says no", value: { type: "a" } },
        { message: "variant says no", value: { type: "a" } },
      ]);
    });

    test("a tag matching no variant reports nothing extra (structural error's job)", () => {
      expect(
        taggedUnion["executeCustomValidateAt"](path, {
          type: "nope",
        } as never),
      ).toEqual([]);
    });

    test("a literal union has no variant to descend into", () => {
      const literalUnion = union(literal("a"), literal("b")).validate((src) =>
        src === "b" ? "not b" : false,
      );
      expect(literalUnion["executeCustomValidateAt"](path, "b")).toEqual([
        { message: "not b", value: "b" },
      ]);
      expect(literalUnion["executeCustomValidateAt"](path, "a")).toEqual([]);
    });
  });
});
