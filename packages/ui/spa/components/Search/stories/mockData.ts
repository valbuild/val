import {
  Internal,
  Json,
  ModuleFilePath,
  ReifiedRender,
  SerializedSchema,
  initVal,
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
      "/blogs/blog-4": {
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
      "/blogs/blog-5": {
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
      "/blogs/blog-6": {
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
      "/blogs/blog-7": {
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
      "/blogs/blog-8": {
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
      "article-3": {
        title: "Advanced Search Features",
        description:
          "Discover advanced search capabilities and how to use them effectively.",
        author: "Jane Smith",
      },
      "article-4": {
        title: "Advanced Search Features",
        description:
          "Discover advanced search capabilities and how to use them effectively.",
        author: "Jane Smith",
      },
      "article-5": {
        title: "Advanced Search Features",
        description:
          "Discover advanced search capabilities and how to use them effectively.",
        author: "Jane Smith",
      },
      "article-6": {
        title: "Advanced Search Features",
        description:
          "Discover advanced search capabilities and how to use them effectively.",
        author: "Jane Smith",
      },
      "article-7": {
        title: "Advanced Search Features",
        description:
          "Discover advanced search capabilities and how to use them effectively.",
        author: "Jane Smith",
      },
      "article-8": {
        title: "Advanced Search Features",
        description:
          "Discover advanced search capabilities and how to use them effectively.",
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
      "author-3": {
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
      "author-4": {
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
      "author-5": {
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
      "author-6": {
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
      "author-7": {
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
      "author-8": {
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

  // Team members record with list view rendering
  const team = c.define(
    "/content/team.val.ts",
    s
      .record(
        s.object({
          name: s.string(),
          position: s.string(),
          bio: s.string(),
          email: s.string(),
        }),
      )
      .render({
        as: "list",
        select({ val }) {
          return {
            title: val.name,
            subtitle: val.position,
          };
        },
      }),
    {
      "team-1": {
        name: "Alice Johnson",
        position: "Senior Engineer",
        bio: "Alice has been leading our engineering team for 5 years.\nShe specializes in distributed systems and performance optimization.",
        email: "alice@example.com",
      },
      "team-2": {
        name: "Bob Williams",
        position: "Product Manager",
        bio: "Bob joined us 3 years ago and has been instrumental in shaping our product vision.\nHe loves working with customers to understand their needs.",
        email: "bob@example.com",
      },
      "team-3": {
        name: "Carol Martinez",
        position: "UI/UX Designer",
        bio: "Carol is passionate about creating delightful user experiences.\nShe has a background in visual design and human-computer interaction.",
        email: "carol@example.com",
      },
    },
  );

  // Product pages router with list view rendering
  const productPages = c.define(
    "/app/products/[product]/page.val.ts",
    s
      .record(
        s.object({
          name: s.string(),
          description: s.string().render({ as: "textarea" }),
          price: s.number(),
          code: s.string().render({ as: "code", language: "json" }),
        }),
      )
      .router(mockRouter)
      .render({
        as: "list",
        select({ val }) {
          return {
            title: val.name,
            subtitle: `$${val.price}`,
          };
        },
      }),
    {
      "/products/product-1": {
        name: "Premium Subscription",
        description:
          "Get access to all premium features including advanced analytics and priority support.",
        price: 99.99,
        code: JSON.stringify(
          {
            sku: "PREM-001",
            features: ["analytics", "support", "api-access"],
          },
          null,
          2,
        ),
      },
      "/products/product-2": {
        name: "Starter Plan",
        description:
          "Perfect for individuals and small teams just getting started.\nIncludes basic features and email support.",
        price: 29.99,
        code: JSON.stringify(
          {
            sku: "START-001",
            features: ["basic-features", "email-support"],
          },
          null,
          2,
        ),
      },
      "/products/product-3": {
        name: "Enterprise Plan",
        description:
          "Custom solutions for large organizations with dedicated account management.",
        price: 499.99,
        code: JSON.stringify(
          {
            sku: "ENT-001",
            features: [
              "all-features",
              "dedicated-support",
              "custom-integrations",
            ],
          },
          null,
          2,
        ),
      },
    },
  );

  // Configuration array with render methods
  const config = c.define(
    "/content/config.val.ts",
    s
      .array(
        s.object({
          key: s.string(),
          value: s.string().render({ as: "code", language: "typescript" }),
          description: s.string().render({ as: "textarea" }),
        }),
      )
      .render({
        as: "list",
        select({ val }) {
          return {
            title: val.key,
            subtitle: val.description,
          };
        },
      }),
    [
      {
        key: "customHook",
        value: `export function useCustomHook() {
  const [state, setState] = useState();
  return state;
}`,
        description:
          "A custom React hook for managing component state.\nThis can be used across multiple components.",
      },
      {
        key: "apiConfig",
        value: `export const API_CONFIG = {
  endpoint: "https://api.example.com",
  timeout: 5000,
  retries: 3
} as const;`,
        description:
          "API configuration for external service calls.\nAdjust timeout and retries based on your needs.",
      },
      {
        key: "utilFunction",
        value: `export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}`,
        description:
          "Utility function for date formatting.\nReturns dates in YYYY-MM-DD format.",
      },
    ],
  );

  // Extract schemas and sources from the modules
  const modules = [
    blogPages,
    articles,
    settings,
    authors,
    team,
    productPages,
    config,
  ];
  const schemas: Record<string, SerializedSchema> = {};
  const sources: Record<string, Json> = {};
  const renders: Record<string, ReifiedRender> = {};
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
      renders[path] = schema["executeRender"](path, source);
    }
  }

  return {
    schemas: schemas as Record<ModuleFilePath, SerializedSchema>,
    sources: sources as Record<ModuleFilePath, Json>,
    renders: renders as Record<ModuleFilePath, ReifiedRender>,
  };
}

export const {
  schemas: mockSchemas,
  sources: mockSources,
  renders: mockRenders,
} = createMockData();
