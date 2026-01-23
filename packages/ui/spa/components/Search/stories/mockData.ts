import {
  Internal,
  Json,
  ModuleFilePath,
  SerializedSchema,
  initVal,
  ValRouter,
} from "@valbuild/core";

/**
 * Create mock data using initVal from @valbuild/core
 * This ensures the schemas and sources are properly structured
 */
function createMockData() {
  const { s, c } = initVal();

  // Create a simple mock router for Storybook
  // In a real app, this would come from @valbuild/next's initVal
  const mockRouter = {
    getRouterId: () => "next-app-router",
    validate: () => [],
  };

  // Router module for blog pages
  const blogPages = c.define(
    "/app/blogs/[blog]/page.val.ts",
    s
      .record(
        s.object({
          title: s.string(),
          content: s.richtext(),
        }),
      )
      .router(mockRouter),
    {
      "/blogs/blog-1": {
        title: "Getting Started with Val",
        content: [
          {
            tag: "p",
            children: [
              "Learn how to get started with Val in this comprehensive guide.",
            ],
          },
        ],
      },
      "/blogs/blog-2": {
        title: "Advanced Search Features",
        content: [
          {
            tag: "p",
            children: [
              "Discover advanced search capabilities and how to use them effectively.",
            ],
          },
        ],
      },
      "/blogs/blog-3": {
        title: "Component Architecture",
        content: [
          {
            tag: "p",
            children: ["Understanding the architecture of Val components."],
          },
        ],
      },
    },
  );

  // Articles record
  const articles = c.define(
    "/content/articles.val.ts",
    s.record(
      s.object({
        title: s.string(),
        description: s.string(),
        author: s.string(),
      }),
    ),
    {
      "article-1": {
        title: "Introduction to Storybook",
        description:
          "A comprehensive guide to Storybook for component development",
        author: "John Doe",
      },
      "article-2": {
        title: "React Best Practices",
        description: "Learn the best practices for building React applications",
        author: "Jane Smith",
      },
    },
  );

  // Settings object
  const settings = c.define(
    "/content/settings.val.ts",
    s.object({
      siteName: s.string(),
      siteDescription: s.string(),
    }),
    {
      siteName: "Val Documentation",
      siteDescription: "The official documentation for Val",
    },
  );

  // Authors record
  const authors = c.define(
    "/content/authors.val.ts",
    s.record(
      s.object({
        name: s.string(),
        bio: s.richtext(),
      }),
    ),
    {
      "author-1": {
        name: "John Doe",
        bio: [
          {
            tag: "p",
            children: [
              "John is a software engineer with 10 years of experience.",
            ],
          },
        ],
      },
      "author-2": {
        name: "Jane Smith",
        bio: [
          {
            tag: "p",
            children: [
              "Jane is a designer and developer passionate about user experience.",
            ],
          },
        ],
      },
    },
  );

  // Extract schemas and sources from the modules
  const modules = [blogPages, articles, settings, authors];
  const schemas: Record<string, SerializedSchema> = {};
  const sources: Record<string, Json> = {};

  for (const module of modules) {
    const moduleFilePath = Internal.getValPath(module);
    const schema = Internal.getSchema(module);
    const source = Internal.getSource(module);

    if (moduleFilePath && schema && source !== undefined) {
      // getValPath returns SourcePath, but we need ModuleFilePath
      // For module files, the path should be a valid ModuleFilePath
      const path = moduleFilePath as unknown as ModuleFilePath;
      schemas[path] = schema["executeSerialize"]();
      sources[path] = source;
    }
  }

  return {
    schemas: schemas as Record<ModuleFilePath, SerializedSchema>,
    sources: sources as Record<ModuleFilePath, Json>,
  };
}

export const { schemas: mockSchemas, sources: mockSources } = createMockData();
