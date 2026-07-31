import { initVal, Internal, ModuleFilePath } from "@valbuild/core";
import { SchemaValidator } from "./validateModule";

const { s, c } = initVal();

function serialize(module: ReturnType<typeof c.define>) {
  const path = Internal.getValPath(module) as unknown as ModuleFilePath;
  const schema = Internal.getSchema(module)!;
  const serializedSchema = schema["executeSerialize"]();
  const source = Internal.getSource(module);
  return { path, serializedSchema, source };
}

describe("SchemaValidator", () => {
  test("returns no errors for a valid source", () => {
    const validator = new SchemaValidator();
    const { path, serializedSchema, source } = serialize(
      c.define("/test.val.ts", s.string().minLength(2), "valid"),
    );
    const errors = validator.validate(path, source, serializedSchema, "sha1");
    expect(errors).toBe(false);
  });

  test("returns validation errors for an invalid source", () => {
    const validator = new SchemaValidator();
    const { path, serializedSchema, source } = serialize(
      c.define("/test.val.ts", s.string().minLength(2), "a"),
    );
    const errors = validator.validate(path, source, serializedSchema, "sha1");
    expect(errors).not.toBe(false);
    expect(
      Object.keys(errors as Record<string, unknown>).length,
    ).toBeGreaterThan(0);
  });

  test("reuses the cached schema while the sha is unchanged", () => {
    const validator = new SchemaValidator();
    // Lenient schema: "valid" (5 chars) passes minLength(2).
    const lenient = serialize(
      c.define("/test.val.ts", s.string().minLength(2), "valid"),
    );
    // Strict schema for the same path/source: "valid" fails minLength(10).
    const strict = serialize(
      c.define("/test.val.ts", s.string().minLength(10), "valid"),
    );

    // First call deserializes and caches the lenient schema under "sha1".
    expect(
      validator.validate(
        lenient.path,
        lenient.source,
        lenient.serializedSchema,
        "sha1",
      ),
    ).toBe(false);

    // Same sha → cached lenient schema is reused even though a different
    // serialized schema is passed, so the source is still considered valid.
    expect(
      validator.validate(
        lenient.path,
        lenient.source,
        strict.serializedSchema,
        "sha1",
      ),
    ).toBe(false);

    // New sha → schema is re-derived from the strict definition and the source
    // now fails validation.
    expect(
      validator.validate(
        lenient.path,
        lenient.source,
        strict.serializedSchema,
        "sha2",
      ),
    ).not.toBe(false);
  });
});
