import { initVal } from "../initVal";
import { SourcePath } from "../val";
import { declaredKeySetOf, missingDeclaredKeys } from "./declaredKeys";
import { ValidationErrors } from "./validation/ValidationError";

const { s, c } = initVal();

describe("declaredKeySetOf", () => {
  test("a union of literals declares its keys, in declaration order", () => {
    const key = s.union(s.literal("nb-NO"), s.literal("en-US"));
    expect(declaredKeySetOf(key["executeSerialize"]())).toEqual({
      kind: "literals",
      keys: ["nb-NO", "en-US"],
    });
  });

  test("a single literal declares the one key", () => {
    expect(declaredKeySetOf(s.literal("only")["executeSerialize"]())).toEqual({
      kind: "literals",
      keys: ["only"],
    });
  });

  test("a locale defers to the settings module, carrying its aliases", () => {
    expect(declaredKeySetOf(s.locale()["executeSerialize"]())).toEqual({
      kind: "locale",
      aliases: undefined,
    });
    expect(
      declaredKeySetOf(
        s.locale().aliases({ "nb-NO": "no" })["executeSerialize"](),
      ),
    ).toEqual({ kind: "locale", aliases: { "nb-NO": ["no"] } });
  });

  test("an open key schema declares nothing", () => {
    expect(declaredKeySetOf(s.string()["executeSerialize"]())).toBe(null);
    expect(declaredKeySetOf(undefined)).toBe(null);
  });

  test("an object union declares nothing: it cannot be a record key at all", () => {
    const objectUnion = s.union(
      "type",
      s.object({ type: s.literal("a"), n: s.number() }),
      s.object({ type: s.literal("b"), n: s.number() }),
    );
    expect(declaredKeySetOf(objectUnion["executeSerialize"]())).toBe(null);
  });

  test("missing keys come back in declaration order, not the source's", () => {
    expect(missingDeclaredKeys(["a", "b", "c"], ["c"])).toEqual(["a", "b"]);
    expect(missingDeclaredKeys(["a", "b"], ["b", "a"])).toEqual([]);
  });
});

describe("a record with a declared key set", () => {
  const at = "/content/a.val.ts" as SourcePath;

  /**
   * The deferred key-set check out of a validation result.
   *
   * Takes the result rather than the schema: `executeValidate` is protected, so
   * a helper that took the schema would need a structural type it cannot have.
   */
  function fillKeysFix(res: ValidationErrors) {
    if (res === false) {
      throw new Error("expected the record to defer its key check");
    }
    return res[at].find((each) => each.fixes?.includes("record:fill-keys"));
  }

  test("defers the key set rather than deciding here, carrying what it knows", () => {
    const schema = s.record(
      s.union(s.literal("a"), s.literal("b")),
      s.string(),
    );
    const fix = fillKeysFix(schema["executeValidate"](at, { a: "x" } as never));
    expect(fix?.value).toEqual({
      present: ["a"],
      declared: ["a", "b"],
      aliases: undefined,
    });
  });

  test("a locale record leaves the key set to the settings module", () => {
    const schema = s.record(s.locale(), s.string());
    const fix = fillKeysFix(
      schema["executeValidate"](at, { "nb-NO": "x" } as never),
    );
    expect(fix?.value).toEqual({
      present: ["nb-NO"],
      declared: null,
      aliases: undefined,
    });
  });

  test("an open record raises no key check at all", () => {
    const schema = s.record(s.string(), s.string());
    const res = schema["executeValidate"](at, { anything: "x" } as never);
    expect(res).toBe(false);
  });

  test("null is an entry, not a value of the wrong type", () => {
    // The whole of the design: an entry nobody has written yet is null, so
    // half-translated content stays VALID and the gap is data you can count.
    const schema = s.record(s.locale(), s.object({ title: s.string() }));
    const res = schema["executeValidate"](at, {
      "en-US": { title: "Jacket" },
      "nb-NO": null,
    } as never);
    if (res === false) {
      throw new Error("expected the record to defer its key check");
    }
    // Everything raised is a check deferred to another module — the key set,
    // and each key as a locale. Nothing at all about the null entry, which is
    // the point: the item schema was never asked about it.
    const errors = Object.entries(res).flatMap(([, list]) => list);
    expect(errors.map((each) => each.fixes?.join(",")).sort()).toEqual([
      "locale:check-locale",
      "locale:check-locale",
      "record:fill-keys",
    ]);
  });

  test("an open record still rejects null, since nothing declared that key", () => {
    const schema = s.record(s.string(), s.object({ title: s.string() }));
    const res = schema["executeValidate"](at, { a: null } as never);
    expect(res).not.toBe(false);
  });

  test("c.define accepts a null entry where the keys are declared", () => {
    const module = c.define(
      "/content/a.val.ts",
      s.record(s.locale(), s.object({ title: s.string() })),
      { "en-US": { title: "Jacket" }, "nb-NO": null },
    );
    expect(module).toBeDefined();
  });
});
