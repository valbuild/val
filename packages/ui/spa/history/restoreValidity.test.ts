import { initVal } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import { structuralErrorsOfRestore } from "./restoreValidity";

const { s } = initVal();

/**
 * The gate between "wrong shape" and "wrong content".
 *
 * The design rule is that a restore refuses a value that cannot BE this field
 * and allows one that merely breaks a rule about its content — because the
 * second is an ordinary editing state that the publish gate already holds, and
 * refusing it would make putting an old value back stricter than typing the
 * same value in. Every case here is on one side or the other of that line.
 *
 * `checkCompatibility` covers what can be answered from the schemas alone and
 * is what marks the fields before anyone clicks. These are the cases it cannot
 * answer: it returns `unknown` for rich text and for a union value carrying no
 * discriminator, and the chrome offers an `unknown` field rather than refusing
 * it.
 */
describe("what a restore refuses", () => {
  test("a string where a number goes", () => {
    // `executeValidate` reports this WITHOUT `typeError`, so filtering
    // validation errors on the flag alone would let it through. This is the
    // case that makes `executeAssert` load-bearing rather than belt-and-braces.
    expect(
      structuralErrorsOfRestore(
        s.number()["executeSerialize"](),
        "twelve" as JSONValue,
      ),
    ).not.toEqual([]);
  });

  test("an object missing a key the target requires", () => {
    expect(
      structuralErrorsOfRestore(
        s.object({ title: s.string(), body: s.string() })["executeSerialize"](),
        { title: "Only half of it" } as JSONValue,
      ),
    ).not.toEqual([]);
  });

  test("rich text that is not rich text", () => {
    /*
     * The case the gate exists for. Comparing every mark and block against a
     * schema's options is not implemented, so `checkCompatibility` answers
     * `unknown` and the chrome offers the field — only a check against the
     * VALUE can catch a node format that has since changed.
     */
    expect(
      structuralErrorsOfRestore(
        s.richtext()["executeSerialize"](),
        "a plain string" as JSONValue,
      ),
    ).not.toEqual([]);
  });

  test("a union value with no discriminator", () => {
    // The other `unknown` from `checkCompatibility`: without the key there is
    // nothing to decide which branch the value claims to be.
    expect(
      structuralErrorsOfRestore(
        s
          .union("type", s.object({ type: s.literal("link"), url: s.string() }))
          ["executeSerialize"](),
        { url: "https://example.com" } as JSONValue,
      ),
    ).not.toEqual([]);
  });

  test("a value aimed at a whole different kind of field", () => {
    expect(
      structuralErrorsOfRestore(
        s.array(s.string())["executeSerialize"](),
        "not a list" as JSONValue,
      ),
    ).not.toEqual([]);
  });

  test("a schema that cannot be read — refused, not thrown", () => {
    // Not a shape any version of Val produces. Reaching the gate with one means
    // the target is not understood, and staging a write into it on that basis
    // is the one outcome that must not happen.
    const errors = structuralErrorsOfRestore(
      { type: "not-a-schema-type" } as never,
      "anything" as JSONValue,
    );
    expect(errors).not.toEqual([]);
    expect(errors[0].schemaError).toBe(true);
  });
});

describe("what a restore allows through to the publish gate", () => {
  test("a value that is the right shape", () => {
    expect(
      structuralErrorsOfRestore(
        s.object({ title: s.string() })["executeSerialize"](),
        { title: "As it was" } as JSONValue,
      ),
    ).toEqual([]);
  });

  test("a one-letter name under minLength(2)", () => {
    /*
     * The half of the rule that is easy to get wrong by being strict. This
     * restores, and is then held at publish by `validation-errors` — which is
     * where a rule about CONTENT belongs. The e2e has both halves for exactly
     * this reason.
     */
    expect(
      structuralErrorsOfRestore(
        s.string().minLength(2)["executeSerialize"](),
        "a" as JSONValue,
      ),
    ).toEqual([]);
  });

  test("an empty list", () => {
    expect(
      structuralErrorsOfRestore(
        s.array(s.string())["executeSerialize"](),
        [] as unknown as JSONValue,
      ),
    ).toEqual([]);
  });
});
