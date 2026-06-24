import { initSchema } from "../initSchema";
import { router } from "./router";
import { nextAppRouter, ValRouter } from "../router";
import { SourcePath } from "../val";
import { deserializeSchema } from "./deserialize";

const s = initSchema();

describe("router", () => {
  const mockRouter: ValRouter = {
    getRouterId: () => "test-router",
    validate: () => [],
  };

  it("should create a router record", () => {
    const schema = s.object({
      title: s.string(),
    });

    const routerSchema = router(mockRouter, schema);

    const serialized = routerSchema["executeSerialize"]();
    expect(serialized.type).toBe("record");
    expect(serialized.router).toBe("test-router");
  });

  it("should be equivalent to s.record().router()", () => {
    const schema = s.object({
      title: s.string(),
    });

    const routerSchema1 = router(mockRouter, schema);
    const routerSchema2 = s.record(schema).router(mockRouter);

    const serialized1 = routerSchema1["executeSerialize"]();
    const serialized2 = routerSchema2["executeSerialize"]();

    expect(serialized1.type).toBe(serialized2.type);
    expect(serialized1.router).toBe(serialized2.router);
    expect(serialized1.opt).toBe(serialized2.opt);
  });

  it("should work with nextAppRouter", () => {
    const schema = s.object({
      title: s.string(),
      content: s.string(),
    });

    const routerSchema = router(nextAppRouter, schema);

    const serialized = routerSchema["executeSerialize"]();
    expect(serialized.type).toBe("record");
    expect(serialized.router).toBe("next-app-router");
  });

  it("should be accessible via s.router()", () => {
    const schema = s.object({
      title: s.string(),
    });

    const routerSchema = s.router(mockRouter, schema);

    expect(routerSchema).toBeDefined();
    const serialized = routerSchema["executeSerialize"]();
    expect(serialized.type).toBe("record");
    expect(serialized.router).toBe("test-router");
  });

  it("should accept valid sources", () => {
    const schema = s.object({
      title: s.string(),
    });

    const routerSchema = s.router(mockRouter, schema);

    // Should create a valid router schema
    expect(routerSchema).toBeDefined();
    const serialized = routerSchema["executeSerialize"]();
    expect(serialized.router).toBe("test-router");
  });

  it("should work with complex schemas", () => {
    const schema = s.object({
      title: s.string(),
      content: s.richtext(),
      published: s.boolean(),
    });

    const routerSchema = s.router(nextAppRouter, schema);

    const serialized = routerSchema["executeSerialize"]();
    expect(serialized.type).toBe("record");
    expect(serialized.router).toBe("next-app-router");
    expect(serialized.item.type).toBe("object");
  });

  describe("key validation", () => {
    // Router that flags any urlPath starting with "/bad"
    const strictMockRouter: ValRouter = {
      getRouterId: () => "strict-mock-router",
      validate: (_moduleFilePath, urlPaths) =>
        urlPaths
          .filter((p) => p.startsWith("/bad"))
          .map((p) => ({
            error: {
              message: `URL path '${p}' is not a valid route`,
              urlPath: p,
              expectedPath: null,
            },
          })),
    };

    it("should serialize describe on the key schema", () => {
      const schema = s.router(
        mockRouter,
        s.string().describe("URL slug"),
        s.object({ title: s.string() }),
      );

      const serialized = schema["executeSerialize"]();
      expect(serialized.type).toBe("record");
      expect(serialized.router).toBe("test-router");
      expect(serialized.key).toBeDefined();
      expect(serialized.key?.type).toBe("string");
      if (serialized.key?.type === "string") {
        expect(serialized.key.description).toBe("URL slug");
      }
    });

    it("should enforce maxLength on keys (with keyError flag)", () => {
      const schema = s.router(
        mockRouter,
        s.string().maxLength(5),
        s.object({ title: s.string() }),
      );

      const result = schema["executeValidate"]("/test.val.ts" as SourcePath, {
        "/ok": { title: "Short" },
        "/way-too-long-key": { title: "Too long" },
      });

      expect(result).not.toBe(false);
      if (result !== false) {
        const allErrors = Object.values(result).flat();
        const lengthErrors = allErrors.filter(
          (e) => e.keyError && e.message.includes("at most 5"),
        );
        expect(lengthErrors).toHaveLength(1);
      }
    });

    it("should run custom validator on keys", () => {
      const schema = s.router(
        mockRouter,
        s
          .string()
          .validate((key) =>
            key.startsWith("/") ? false : "Key must start with '/'",
          ),
        s.object({ title: s.string() }),
      );

      const result = schema["executeValidate"]("/test.val.ts" as SourcePath, {
        "/good": { title: "Good" },
        "bad-no-slash": { title: "Bad" },
      });

      expect(result).not.toBe(false);
      if (result !== false) {
        const allErrors = Object.values(result).flat();
        const customErrors = allErrors.filter(
          (e) => e.keyError && e.message === "Key must start with '/'",
        );
        expect(customErrors).toHaveLength(1);
      }
    });

    it("should surface both router pattern and key schema errors at the same key path", () => {
      const schema = s.router(
        strictMockRouter,
        s.string().maxLength(5),
        s.object({ title: s.string() }),
      );

      const result = schema["executeValidate"]("/test.val.ts" as SourcePath, {
        "/bad-and-too-long": { title: "Fails both" },
      });

      expect(result).not.toBe(false);
      if (result !== false) {
        const keyPath = Object.keys(result).find((p) =>
          p.includes("/bad-and-too-long"),
        );
        expect(keyPath).toBeDefined();
        if (keyPath) {
          const errsAtKey = result[keyPath as SourcePath];
          // Router pattern error from strictMockRouter
          expect(
            errsAtKey.some(
              (e) => e.keyError && e.message.includes("not a valid route"),
            ),
          ).toBe(true);
          // Key schema maxLength error
          expect(
            errsAtKey.some(
              (e) => e.keyError && e.message.includes("at most 5"),
            ),
          ).toBe(true);
        }
      }
    });

    it("should still work with the two-arg form (no key schema)", () => {
      const schema = s.router(mockRouter, s.object({ title: s.string() }));
      const result = schema["executeValidate"]("/test.val.ts" as SourcePath, {
        "any-key-is-fine": { title: "Yes" },
        "another-key": { title: "Also fine" },
      });
      expect(result).toBe(false);

      const serialized = schema["executeSerialize"]();
      expect(serialized.key).toBeDefined();
      expect(serialized.key?.type).toBe("string");
    });

    it("should be equivalent to s.record(key, value).router()", () => {
      const keySchema = s.string().maxLength(5).describe("URL slug");
      const valueSchema = s.object({ title: s.string() });

      const viaRouter = s.router(mockRouter, keySchema, valueSchema);
      const viaRecord = s.record(keySchema, valueSchema).router(mockRouter);

      const a = viaRouter["executeSerialize"]();
      const b = viaRecord["executeSerialize"]();

      expect(a.type).toBe(b.type);
      expect(a.router).toBe(b.router);
      expect(a.opt).toBe(b.opt);
      expect(a.key?.type).toBe(b.key?.type);
      if (a.key?.type === "string" && b.key?.type === "string") {
        expect(a.key.description).toBe(b.key.description);
      }
    });

    it("should round-trip through serialize/deserialize with key validation", () => {
      const schema = s.router(
        mockRouter,
        s.string().maxLength(5).describe("URL slug"),
        s.object({ title: s.string() }),
      );

      const serialized = schema["executeSerialize"]();
      const deserialized = deserializeSchema(serialized);

      const failing = deserialized["executeValidate"](
        "/test.val.ts" as SourcePath,
        { "way-too-long": { title: "X" } },
      );
      expect(failing).not.toBe(false);
      if (failing !== false) {
        const allErrors = Object.values(failing).flat();
        expect(
          allErrors.some((e) => e.keyError && e.message.includes("at most 5")),
        ).toBe(true);
      }

      const reserialized = deserialized["executeSerialize"]();
      expect(reserialized.type).toBe("record");
      if (
        reserialized.type === "record" &&
        reserialized.key?.type === "string"
      ) {
        expect(reserialized.key.description).toBe("URL slug");
      }
    });
  });
});
