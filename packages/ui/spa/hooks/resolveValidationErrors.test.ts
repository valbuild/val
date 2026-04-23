import {
  Internal,
  type ModuleFilePath,
  type SerializedSchema,
  type Source,
  type SourcePath,
  type ValidationError,
  type ValModule,
  initVal,
} from "@valbuild/core";
import { filterBlockingValidationErrors } from "./resolveValidationErrors";

const { s, c } = initVal();

function getTestData(valModules: ValModule<Source>[]) {
  const schemas: Record<ModuleFilePath, SerializedSchema> = {};
  const sources: Record<ModuleFilePath, Source> = {};
  for (const valModule of valModules) {
    const moduleFilePath = Internal.getValPath(
      valModule,
    ) as unknown as ModuleFilePath;
    const schema = Internal.getSchema(valModule)?.["executeSerialize"]();
    if (!schema) throw new Error("Schema not found");
    schemas[moduleFilePath] = schema;
    const source = Internal.getSource(valModule);
    if (source === undefined) throw new Error("Source not found");
    sources[moduleFilePath] = source;
  }
  return { schemas, sources };
}

describe("filterBlockingValidationErrors", () => {
  test("errors without fixes are blocking", () => {
    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/page.val.ts" as SourcePath]: [{ message: "Required field" }],
    };
    const result = filterBlockingValidationErrors(errors, {}, {});
    expect(result).toEqual(errors);
  });

  test("errors with non-keyof/router fixes are non-blocking", () => {
    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/page.val.ts" as SourcePath]: [
        { message: "Missing metadata", fixes: ["image:check-metadata"] },
        { message: "Missing metadata", fixes: ["file:add-metadata"] },
      ],
    };
    const result = filterBlockingValidationErrors(errors, {}, {});
    expect(result).toEqual({});
  });

  test("keyof:check-keys — valid key is non-blocking", () => {
    const pages = c.define(
      "/content/pages.val.ts",
      s.record(s.object({ title: s.string() })),
      { home: { title: "Home" }, about: { title: "About" } },
    );
    const { schemas, sources } = getTestData([pages]);

    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/ref.val.ts" as SourcePath]: [
        {
          message: "keyof check",
          fixes: ["keyof:check-keys"],
          value: {
            key: "home",
            sourcePath: "/content/pages.val.ts" as SourcePath,
          },
        },
      ],
    };
    const result = filterBlockingValidationErrors(errors, schemas, sources);
    expect(result).toEqual({});
  });

  test("keyof:check-keys — invalid key is blocking with valid keys listed", () => {
    const pages = c.define(
      "/content/pages.val.ts",
      s.record(s.object({ title: s.string() })),
      { home: { title: "Home" }, about: { title: "About" } },
    );
    const { schemas, sources } = getTestData([pages]);

    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/ref.val.ts" as SourcePath]: [
        {
          message: "keyof check",
          fixes: ["keyof:check-keys"],
          value: {
            key: "nonexistent",
            sourcePath: "/content/pages.val.ts" as SourcePath,
          },
        },
      ],
    };
    const result = filterBlockingValidationErrors(errors, schemas, sources);
    expect(
      result["/content/ref.val.ts" as SourcePath]?.[0]?.message,
    ).toContain("nonexistent");
    expect(
      result["/content/ref.val.ts" as SourcePath]?.[0]?.message,
    ).toContain("home");
    expect(
      result["/content/ref.val.ts" as SourcePath]?.[0]?.message,
    ).toContain("about");
  });

  test("router:check-route — valid route is non-blocking", () => {
    const router = c.define(
      "/content/router.val.ts",
      s.record(s.string()).router(Internal.nextAppRouter),
      { "/blog/post-1": "post-1", "/blog/post-2": "post-2" },
    );
    const { schemas, sources } = getTestData([router]);

    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/page.val.ts" as SourcePath]: [
        {
          message: "router check",
          fixes: ["router:check-route"],
          value: { route: "/blog/post-1" },
        },
      ],
    };
    const result = filterBlockingValidationErrors(errors, schemas, sources);
    expect(result).toEqual({});
  });

  test("router:check-route — invalid route is blocking with valid routes listed", () => {
    const router = c.define(
      "/content/router.val.ts",
      s.record(s.string()).router(Internal.nextAppRouter),
      { "/blog/post-1": "post-1", "/blog/post-2": "post-2" },
    );
    const { schemas, sources } = getTestData([router]);

    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/page.val.ts" as SourcePath]: [
        {
          message: "router check",
          fixes: ["router:check-route"],
          value: { route: "/blog/nonexistent" },
        },
      ],
    };
    const result = filterBlockingValidationErrors(errors, schemas, sources);
    expect(
      result["/content/page.val.ts" as SourcePath]?.[0]?.message,
    ).toContain("/blog/nonexistent");
    expect(
      result["/content/page.val.ts" as SourcePath]?.[0]?.message,
    ).toContain("/blog/post-1");
    expect(
      result["/content/page.val.ts" as SourcePath]?.[0]?.message,
    ).toContain("/blog/post-2");
  });

  test("router:check-route with include pattern — matching route is non-blocking", () => {
    const router = c.define(
      "/content/router.val.ts",
      s.record(s.string()).router(Internal.nextAppRouter),
      { "/blog/post-1": "post-1", "/shop/item-1": "item-1" },
    );
    const { schemas, sources } = getTestData([router]);

    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/page.val.ts" as SourcePath]: [
        {
          message: "router check",
          fixes: ["router:check-route"],
          value: {
            route: "/blog/post-1",
            include: { source: "^\\/blog\\/", flags: "" },
          },
        },
      ],
    };
    const result = filterBlockingValidationErrors(errors, schemas, sources);
    expect(result).toEqual({});
  });

  test("router:check-route with exclude pattern — excluded route is blocking", () => {
    const router = c.define(
      "/content/router.val.ts",
      s.record(s.string()).router(Internal.nextAppRouter),
      { "/blog/post-1": "post-1", "/shop/item-1": "item-1" },
    );
    const { schemas, sources } = getTestData([router]);

    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/page.val.ts" as SourcePath]: [
        {
          message: "router check",
          fixes: ["router:check-route"],
          value: {
            route: "/shop/item-1",
            exclude: { source: "^\\/shop\\/", flags: "" },
          },
        },
      ],
    };
    const result = filterBlockingValidationErrors(errors, schemas, sources);
    expect(result["/content/page.val.ts" as SourcePath]).toHaveLength(1);
  });

  test("mix: some errors blocking, some not", () => {
    const pages = c.define(
      "/content/pages.val.ts",
      s.record(s.object({ title: s.string() })),
      { home: { title: "Home" } },
    );
    const { schemas, sources } = getTestData([pages]);

    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/ref.val.ts" as SourcePath]: [
        { message: "type error" },
        { message: "image meta", fixes: ["image:check-metadata"] },
        {
          message: "keyof check",
          fixes: ["keyof:check-keys"],
          value: {
            key: "home",
            sourcePath: "/content/pages.val.ts" as SourcePath,
          },
        },
      ],
    };
    const result = filterBlockingValidationErrors(errors, schemas, sources);
    expect(result["/content/ref.val.ts" as SourcePath]).toHaveLength(1);
    expect(result["/content/ref.val.ts" as SourcePath]?.[0]?.message).toBe(
      "type error",
    );
  });
});
