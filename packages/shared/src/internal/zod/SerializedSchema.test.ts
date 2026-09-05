import { initVal, Schema, SelectorSource } from "@valbuild/core";
import { SerializedSchema } from "./SerializedSchema";

const { s } = initVal();

/**
 * These z.objects STRIP unknown keys, so anything the serialized schema carries
 * but this parser does not declare is dropped between the server and the
 * Studio - silently, and only for the field that forgot it. That is what these
 * round-trips are here to catch.
 */
const serialize = (schema: Schema<SelectorSource>) =>
  schema["executeSerialize"]();

describe("SerializedSchema round-trips", () => {
  test("richtext keeps its options", () => {
    const parsed = SerializedSchema.safeParse(
      serialize(s.richtext({ bold: true, ul: true, a: true })),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({
      type: "richtext",
      options: { bold: true, ul: true, a: true },
    });
  });

  test("richtext keeps maxLength and minLength", () => {
    const parsed = SerializedSchema.safeParse(
      serialize(s.richtext({ bold: true }).minLength(2).maxLength(10)),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({
      type: "richtext",
      options: { minLength: 2, maxLength: 10 },
    });
  });

  test("richtext keeps the schemas its `a` and `img` options carry", () => {
    const parsed = SerializedSchema.safeParse(
      serialize(s.richtext({ a: s.route(), img: s.image() })),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({
      type: "richtext",
      options: { a: { type: "route" }, img: { type: "image" } },
    });
  });
});
