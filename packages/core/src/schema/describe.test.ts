import { Schema, SerializedSchema } from ".";
import { SelectorSource } from "../selector";
import { array } from "./array";
import { boolean } from "./boolean";
import { date } from "./date";
import { deserializeSchema } from "./deserialize";
import { image } from "./image";
import { literal } from "./literal";
import { number } from "./number";
import { object } from "./object";
import { record } from "./record";
import { richtext } from "./richtext";
import { route } from "./route";
import { string } from "./string";
import { union } from "./union";

describe("Schema.describe()", () => {
  test("string: describe is serialized", () => {
    const schema = string().describe("Authors name");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "string",
      description: "Authors name",
    });
  });

  test("number: describe is serialized", () => {
    const schema = number().describe("Age");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "number",
      description: "Age",
    });
  });

  test("boolean: describe is serialized", () => {
    const schema = boolean().describe("Is published");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "boolean",
      description: "Is published",
    });
  });

  test("date: describe is serialized", () => {
    const schema = date().describe("Birthday");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "date",
      description: "Birthday",
    });
  });

  test("literal: describe is serialized", () => {
    const schema = literal("admin").describe("Access tier");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "literal",
      description: "Access tier",
    });
  });

  test("route: describe is serialized", () => {
    const schema = route().describe("Page route");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "route",
      description: "Page route",
    });
  });

  test("richtext: describe is serialized", () => {
    const schema = richtext({}).describe("Body copy");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "richtext",
      description: "Body copy",
    });
  });

  test("object: describe is serialized on the object schema itself", () => {
    const schema = object({
      name: string().describe("Authors name"),
    }).describe("Author of blog");
    const serialized = schema["executeSerialize"]();
    expect(serialized).toMatchObject({
      type: "object",
      description: "Author of blog",
    });
    expect(
      (serialized as { items: Record<string, unknown> }).items.name,
    ).toMatchObject({
      type: "string",
      description: "Authors name",
    });
  });

  test("array: describe is serialized; item description survives", () => {
    const schema = array(string().describe("Tag")).describe("Tags");
    const serialized = schema["executeSerialize"]();
    expect(serialized).toMatchObject({
      type: "array",
      description: "Tags",
    });
    expect(serialized.item).toMatchObject({
      type: "string",
      description: "Tag",
    });
  });

  test("record: describe is serialized on both key and value schemas", () => {
    const schema = record(
      string().describe("Email"),
      object({ name: string().describe("Authors name") }).describe("Author"),
    );
    const serialized = schema["executeSerialize"]();
    expect(serialized.type).toBe("record");
    expect(serialized.key).toMatchObject({
      type: "string",
      description: "Email",
    });
    expect(serialized.item).toMatchObject({
      type: "object",
      description: "Author",
    });
  });

  test("describe survives after .nullable()", () => {
    const schema = string().describe("X").nullable();
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "string",
      description: "X",
      opt: true,
    });
  });

  test("describe survives after .minLength() / .maxLength() / .regexp() on string", () => {
    const schema = string()
      .describe("Slug")
      .minLength(1)
      .maxLength(10)
      .regexp(/^[a-z]+$/);
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "string",
      description: "Slug",
    });
  });

  test("describe can be added at the end of a chain", () => {
    const schema = string().minLength(1).maxLength(10).describe("Slug");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "string",
      description: "Slug",
    });
  });

  test("describe survives after .min() / .max() on number", () => {
    const schema = number().describe("Score").min(0).max(100);
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "number",
      description: "Score",
    });
  });

  test("describe survives after .from() / .to() on date", () => {
    const schema = date()
      .describe("Event date")
      .from("2020-01-01")
      .to("2030-12-31");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "date",
      description: "Event date",
    });
  });

  test("describe survives after .raw() on string", () => {
    const schema = string().describe("Code").raw();
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "string",
      description: "Code",
      raw: true,
    });
  });

  test("describe survives after .validate() on object", () => {
    const schema = object({ name: string() })
      .describe("Author")
      .validate(() => false);
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "object",
      description: "Author",
    });
  });

  test("schemas without describe serialize description as undefined", () => {
    const schema = string();
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "string",
      description: undefined,
    });
  });

  test("later describe call replaces earlier one", () => {
    const schema = string().describe("first").describe("second");
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "string",
      description: "second",
    });
  });

  test("describe(null) clears a previously set description", () => {
    const schema = string().describe("hello").describe(null);
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "string",
      description: undefined,
    });
  });

  test("describe(null) on a schema with no description is a no-op", () => {
    const schema = number().describe(null);
    expect(schema["executeSerialize"]()).toMatchObject({
      type: "number",
      description: undefined,
    });
  });

  test("describe(null) on record clears description on item and key independently", () => {
    const schema = record(
      string().describe("Email"),
      object({}).describe("Author").describe(null),
    );
    const serialized = schema["executeSerialize"]();
    expect(serialized.key).toMatchObject({
      type: "string",
      description: "Email",
    });
    expect(serialized.item).toMatchObject({
      type: "object",
      description: undefined,
    });
  });
});

describe("Schema.describe() survives serialize → deserialize round-trip", () => {
  // executeSerialize → deserializeSchema → executeSerialize must preserve the
  // description for every schema type that supports describe().
  function roundTrip(schema: Schema<SelectorSource>): SerializedSchema {
    const serialized = schema["executeSerialize"]();
    return deserializeSchema(serialized)["executeSerialize"]();
  }

  test("string", () => {
    expect(roundTrip(string().describe("Authors name"))).toMatchObject({
      type: "string",
      description: "Authors name",
    });
  });

  test("number", () => {
    expect(roundTrip(number().describe("Age"))).toMatchObject({
      type: "number",
      description: "Age",
    });
  });

  test("boolean", () => {
    expect(roundTrip(boolean().describe("Is published"))).toMatchObject({
      type: "boolean",
      description: "Is published",
    });
  });

  test("date", () => {
    expect(roundTrip(date().describe("Birthday"))).toMatchObject({
      type: "date",
      description: "Birthday",
    });
  });

  test("literal", () => {
    expect(roundTrip(literal("admin").describe("Access tier"))).toMatchObject({
      type: "literal",
      description: "Access tier",
    });
  });

  test("route", () => {
    expect(roundTrip(route().describe("Page route"))).toMatchObject({
      type: "route",
      description: "Page route",
    });
  });

  test("richtext", () => {
    expect(roundTrip(richtext({}).describe("Body copy"))).toMatchObject({
      type: "richtext",
      description: "Body copy",
    });
  });

  test("image", () => {
    expect(roundTrip(image().describe("Cover image"))).toMatchObject({
      type: "image",
      description: "Cover image",
    });
  });

  test("object (and nested item description)", () => {
    const serialized = roundTrip(
      object({ name: string().describe("Authors name") }).describe(
        "Author of blog",
      ),
    );
    expect(serialized).toMatchObject({
      type: "object",
      description: "Author of blog",
    });
    expect(
      (serialized as { items: Record<string, unknown> }).items.name,
    ).toMatchObject({
      type: "string",
      description: "Authors name",
    });
  });

  test("array (and nested item description)", () => {
    const serialized = roundTrip(
      array(string().describe("Tag")).describe("Tags"),
    );
    expect(serialized).toMatchObject({ type: "array", description: "Tags" });
    expect((serialized as { item: unknown }).item).toMatchObject({
      type: "string",
      description: "Tag",
    });
  });

  test("union (and nested member description)", () => {
    const serialized = roundTrip(
      union(
        literal("a").describe("First"),
        literal("b").describe("Second"),
      ).describe("Either"),
    );
    expect(serialized).toMatchObject({ type: "union", description: "Either" });
    // The first literal becomes the union `key`; the rest land in `items`.
    expect((serialized as { key: unknown }).key).toMatchObject({
      type: "literal",
      description: "First",
    });
    expect((serialized as { items: unknown[] }).items[0]).toMatchObject({
      type: "literal",
      description: "Second",
    });
  });

  test("record (and nested key/value descriptions)", () => {
    const serialized = roundTrip(
      record(
        object({ name: string().describe("Authors name") }).describe("Author"),
      ),
    );
    expect(serialized).toMatchObject({
      type: "record",
      description: undefined,
    });
    expect((serialized as { item: unknown }).item).toMatchObject({
      type: "object",
      description: "Author",
    });
  });

  test("keyOf", () => {
    // keyOf requires a module selector to construct via the factory, so build
    // the serialized form directly to exercise the deserializer.
    const serialized: SerializedSchema = {
      type: "keyOf",
      path: "/foo" as never,
      schema: { type: "object", keys: [], opt: false },
      opt: false,
      values: ["a", "b"],
      description: "Which key",
    };
    expect(deserializeSchema(serialized)["executeSerialize"]()).toMatchObject({
      type: "keyOf",
      description: "Which key",
    });
  });
});
