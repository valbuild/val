import { initVal, Json, Schema, SelectorSource } from "@valbuild/core";
import {
  checkCompatibility,
  explainIncompatible,
  type IncompatibleReason,
} from "./compatibility";

const { s } = initVal();

/**
 * The serialized form is what a restore actually compares — a stored schema
 * arrives over the wire, never as a live `Schema` with its closures.
 */
function ser(schema: Schema<SelectorSource>) {
  return schema["executeSerialize"]();
}

describe("checkCompatibility", () => {
  describe("the union rule", () => {
    test("a variant that still exists is compatible, even though the union changed", () => {
      // Then: link | button. Now: link | button | ghost. The union is not the
      // same union, but the value being restored still has somewhere to go.
      const before = s.union(
        "kind",
        s.object({ kind: s.literal("link"), label: s.string() }),
        s.object({ kind: s.literal("button"), label: s.string() }),
      );
      const now = s.union(
        "kind",
        s.object({ kind: s.literal("link"), label: s.string() }),
        s.object({ kind: s.literal("button"), label: s.string() }),
        s.object({ kind: s.literal("ghost"), label: s.string() }),
      );
      const res = checkCompatibility(
        { schema: ser(before), value: { kind: "button", label: "Go" } },
        { schema: ser(now) },
      );
      expect(res.status).toBe("compatible");
    });

    test("a variant that was removed is not", () => {
      const before = s.union(
        "kind",
        s.object({ kind: s.literal("link"), label: s.string() }),
        s.object({ kind: s.literal("marquee"), label: s.string() }),
      );
      const now = s.union(
        "kind",
        s.object({ kind: s.literal("link"), label: s.string() }),
      );
      const res = checkCompatibility(
        { schema: ser(before), value: { kind: "marquee", label: "Go" } },
        { schema: ser(now) },
      );
      expect(res).toEqual({
        status: "incompatible",
        reason: { kind: "no-matching-variant", variants: ["link"] },
      });
    });

    test("a plain object restores into a union that now contains its shape", () => {
      // The case from the plan: `cta` was an object, today it is a union.
      const before = s.object({ kind: s.literal("link"), label: s.string() });
      const now = s.union(
        "kind",
        s.object({ kind: s.literal("link"), label: s.string() }),
        s.object({ kind: s.literal("button"), label: s.string() }),
      );
      const res = checkCompatibility(
        { schema: ser(before), value: { kind: "link", label: "Docs" } },
        { schema: ser(now) },
      );
      expect(res.status).toBe("compatible");
    });

    test("string unions compare by their literals", () => {
      const before = s.union(s.literal("sm"), s.literal("lg"));
      const now = s.union(s.literal("sm"), s.literal("md"), s.literal("lg"));
      expect(
        checkCompatibility(
          { schema: ser(before), value: "lg" },
          { schema: ser(now) },
        ).status,
      ).toBe("compatible");
      expect(
        checkCompatibility(
          { schema: ser(before), value: "xl" },
          { schema: ser(now) },
        ).status,
      ).toBe("incompatible");
    });
  });

  describe("objects", () => {
    test("a field that no longer exists blocks the restore", () => {
      const before = s.object({ title: s.string(), subtitle: s.string() });
      const now = s.object({ title: s.string() });
      const res = checkCompatibility(
        { schema: ser(before), value: { title: "A", subtitle: "B" } },
        { schema: ser(now) },
      );
      expect(res).toEqual({
        status: "incompatible",
        reason: { kind: "unknown-field", keys: ["subtitle"] },
      });
    });

    test("a newly required field the old value cannot supply blocks it", () => {
      const before = s.object({ title: s.string() });
      const now = s.object({ title: s.string(), slug: s.string() });
      const res = checkCompatibility(
        { schema: ser(before), value: { title: "A" } },
        { schema: ser(now) },
      );
      expect(res).toEqual({
        status: "incompatible",
        reason: { kind: "missing-required", keys: ["slug"] },
      });
    });

    test("a newly OPTIONAL field is fine", () => {
      const before = s.object({ title: s.string() });
      const now = s.object({ title: s.string(), slug: s.string().nullable() });
      expect(
        checkCompatibility(
          { schema: ser(before), value: { title: "A" } },
          { schema: ser(now) },
        ).status,
      ).toBe("compatible");
    });

    test("a type change nested inside is found", () => {
      const before = s.object({ meta: s.object({ views: s.string() }) });
      const now = s.object({ meta: s.object({ views: s.number() }) });
      const res = checkCompatibility(
        { schema: ser(before), value: { meta: { views: "12" } } },
        { schema: ser(now) },
      );
      expect(res).toEqual({
        status: "incompatible",
        reason: { kind: "type-changed", from: "string", to: "number" },
      });
    });
  });

  describe("emptiness", () => {
    test("null into a field that cannot be empty is refused", () => {
      const res = checkCompatibility(
        { schema: ser(s.string().nullable()), value: null },
        { schema: ser(s.string()) },
      );
      expect(res).toEqual({
        status: "incompatible",
        reason: { kind: "not-optional" },
      });
    });

    test("null into an optional field is fine", () => {
      expect(
        checkCompatibility(
          { schema: ser(s.string().nullable()), value: null },
          { schema: ser(s.string().nullable()) },
        ).status,
      ).toBe("compatible");
    });
  });

  describe("arrays", () => {
    test("every item is checked, not just the first", () => {
      const before = s.array(
        s.union(
          "kind",
          s.object({ kind: s.literal("a"), v: s.string() }),
          s.object({ kind: s.literal("b"), v: s.string() }),
        ),
      );
      const now = s.array(
        s.union("kind", s.object({ kind: s.literal("a"), v: s.string() })),
      );
      const res = checkCompatibility(
        {
          schema: ser(before),
          value: [
            { kind: "a", v: "1" },
            { kind: "b", v: "2" },
          ],
        },
        { schema: ser(now) },
      );
      expect(res.status).toBe("incompatible");
    });

    test("an empty list is decided on the item types, not waved through", () => {
      const res = checkCompatibility(
        { schema: ser(s.array(s.string())), value: [] },
        { schema: ser(s.array(s.number())) },
      );
      expect(res).toEqual({
        status: "incompatible",
        reason: { kind: "type-changed", from: "string", to: "number" },
      });
    });
  });

  describe("unknown", () => {
    test("richtext says it cannot confirm rather than guessing", () => {
      const schema = ser(s.richtext({}));
      const res = checkCompatibility({ schema, value: [] }, { schema });
      expect(res.status).toBe("unknown");
    });

    test("a union value that does not identify its variant is unknown", () => {
      const before = s.union(
        "kind",
        s.object({ kind: s.literal("link"), label: s.string() }),
      );
      const res = checkCompatibility(
        // No `kind` on the value: nothing says which shape this is.
        { schema: ser(before), value: { label: "Go" } },
        { schema: ser(s.object({ label: s.string() })) },
      );
      expect(res.status).toBe("unknown");
    });
  });

  test("every refusal has wording an editor can act on", () => {
    const reasons: IncompatibleReason[] = [
      { kind: "type-changed", from: "string", to: "number" },
      { kind: "no-matching-variant", variants: ["link"] },
      { kind: "unknown-field", keys: ["subtitle"] },
      { kind: "missing-required", keys: ["slug"] },
      { kind: "not-optional" },
      { kind: "literal-changed", from: "a", to: "b" },
      { kind: "different-module", from: "/a.val.ts", to: "/b.val.ts" },
    ];
    for (const reason of reasons) {
      const message = explainIncompatible(reason);
      expect(message.length).toBeGreaterThan(0);
      // No bare enum names leaking into a sentence a person reads.
      expect(message).not.toContain(reason.kind);
    }
  });
});

/** Values are `Json` at the boundary; this keeps the tests honest about that. */
const _typecheck: Json = null;
void _typecheck;
