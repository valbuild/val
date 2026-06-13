import {
  Internal,
  initVal,
  type ModuleFilePath,
  type SerializedSchema,
  type Source,
  type SourcePath,
  type ValidationError,
  type ValModule,
} from "@valbuild/core";
import {
  resolveSchemaSourceFixes,
  resolveSchemaSourceFixForError,
} from "./resolveSchemaSourceFixes";

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

describe("resolveSchemaSourceFixes", () => {
  test("errors without keyof/router fixes pass through unchanged", () => {
    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/page.val.ts" as SourcePath]: [
        { message: "Required field" },
        { message: "Missing metadata", fixes: ["image:check-metadata"] },
        { message: "Missing metadata", fixes: ["file:add-metadata"] },
      ],
    };
    const result = resolveSchemaSourceFixes(errors, {
      schemas: {},
      sources: {},
    });
    expect(result).toEqual(errors);
  });

  test("keyof:check-keys — valid key drops error", () => {
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
    const result = resolveSchemaSourceFixes(errors, {
      schemas,
      sources: sources as Record<ModuleFilePath, Source>,
    });
    expect(result).toEqual({});
  });

  test("keyof:check-keys — invalid key surfaces with 'did you mean' suggestion", () => {
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
            key: "hone",
            sourcePath: "/content/pages.val.ts" as SourcePath,
          },
        },
      ],
    };
    const result = resolveSchemaSourceFixes(errors, {
      schemas,
      sources: sources as Record<ModuleFilePath, Source>,
    });
    const message =
      result["/content/ref.val.ts" as SourcePath]?.[0]?.message ?? "";
    expect(message).toContain("hone");
    expect(message).toContain("Closest match: 'home'");
    expect(message).toContain("about");
    expect(
      result["/content/ref.val.ts" as SourcePath]?.[0]?.fixes,
    ).toBeUndefined();
  });

  test("keyof:check-keys — missing value yields typeError", () => {
    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/ref.val.ts" as SourcePath]: [
        { message: "keyof check", fixes: ["keyof:check-keys"] },
      ],
    };
    const result = resolveSchemaSourceFixes(errors, {
      schemas: {},
      sources: {},
    });
    const error = result["/content/ref.val.ts" as SourcePath]?.[0];
    expect(error?.typeError).toBe(true);
    expect(error?.message).toContain("version mismatch");
  });

  test("router:check-route — valid route drops error", () => {
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
    const result = resolveSchemaSourceFixes(errors, {
      schemas,
      sources: sources as Record<ModuleFilePath, Source>,
    });
    expect(result).toEqual({});
  });

  test("router:check-route — invalid route surfaces with 'did you mean'", () => {
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
          value: { route: "/blog/post-3" },
        },
      ],
    };
    const result = resolveSchemaSourceFixes(errors, {
      schemas,
      sources: sources as Record<ModuleFilePath, Source>,
    });
    const message =
      result["/content/page.val.ts" as SourcePath]?.[0]?.message ?? "";
    expect(message).toContain("/blog/post-3");
    expect(message).toContain("/blog/post-1");
    expect(message).toContain("/blog/post-2");
    expect(
      result["/content/page.val.ts" as SourcePath]?.[0]?.fixes,
    ).toBeUndefined();
  });

  test("router:check-route — include pattern matching route is dropped", () => {
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
    const result = resolveSchemaSourceFixes(errors, {
      schemas,
      sources: sources as Record<ModuleFilePath, Source>,
    });
    expect(result).toEqual({});
  });

  test("router:check-route — excluded route remains", () => {
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
    const result = resolveSchemaSourceFixes(errors, {
      schemas,
      sources: sources as Record<ModuleFilePath, Source>,
    });
    expect(result["/content/page.val.ts" as SourcePath]).toHaveLength(1);
  });

  test("router:check-route — no router modules produces explanatory error", () => {
    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/page.val.ts" as SourcePath]: [
        {
          message: "router check",
          fixes: ["router:check-route"],
          value: { route: "/some/route" },
        },
      ],
    };
    const result = resolveSchemaSourceFixes(errors, {
      schemas: {},
      sources: {},
    });
    const message =
      result["/content/page.val.ts" as SourcePath]?.[0]?.message ?? "";
    expect(message).toContain("No router modules found");
  });

  test("mix: some errors resolved, some rewritten, some untouched", () => {
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
          message: "keyof check valid",
          fixes: ["keyof:check-keys"],
          value: {
            key: "home",
            sourcePath: "/content/pages.val.ts" as SourcePath,
          },
        },
        {
          message: "keyof check invalid",
          fixes: ["keyof:check-keys"],
          value: {
            key: "nope",
            sourcePath: "/content/pages.val.ts" as SourcePath,
          },
        },
      ],
    };
    const result = resolveSchemaSourceFixes(errors, {
      schemas,
      sources: sources as Record<ModuleFilePath, Source>,
    });
    // type error, image meta (passthrough), invalid keyof → 3 entries (valid keyof dropped)
    expect(result["/content/ref.val.ts" as SourcePath]).toHaveLength(3);
  });
});

describe("resolveSchemaSourceFixForError", () => {
  test("returns null for unrelated fix codes", () => {
    expect(
      resolveSchemaSourceFixForError(
        { message: "x", fixes: ["image:check-metadata"] },
        { schemas: {}, sources: {} },
      ),
    ).toBeNull();
  });

  test("returns null for errors without fixes", () => {
    expect(
      resolveSchemaSourceFixForError(
        { message: "x" },
        { schemas: {}, sources: {} },
      ),
    ).toBeNull();
  });
});
