import { initSchema } from "../initSchema";
import { router } from "./router";
import { nextAppRouter, ValRouter } from "../router";

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

    expect(routerSchema).toBeDefined();
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
});
