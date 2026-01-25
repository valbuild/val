import type { Meta, StoryObj } from "@storybook/react";
import { useMemo, useState } from "react";
import {
  Json,
  ModuleFilePath,
  ReifiedRender,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import { SearchResultsList, type SearchResult } from "../../SearchResultsList";
import { Command } from "../../designSystem/command";
import { mockSchemas, mockSources, mockRenders } from "./mockData";
import { ValSyncEngine } from "../../../ValSyncEngine";
import { ValThemeProvider, Themes } from "../../ValThemeProvider";
import { ValErrorProvider } from "../../ValErrorProvider";
import { ValPortalProvider } from "../../ValPortalProvider";
import { ValRemoteProvider } from "../../ValRemoteProvider";
import { ValFieldProvider } from "../../ValFieldProvider";
import { ValRouter } from "../../ValRouter";
import { ValClient } from "@valbuild/shared/internal";

// Create a minimal mock ValClient for Storybook
function createMockClient(): ValClient {
  return (async () => {
    return {
      status: 200,
      json: async () => ({
        schemas: mockSchemas,
        sources: mockSources,
        config: { project: "storybook-test" },
      }),
    } as unknown as Awaited<ReturnType<ValClient>>;
  }) as ValClient;
}

// Helper to create mock search results
function createMockSearchResults(
  count: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, //  we only have 8 articles, blogs and authors
  isPage: boolean,
): SearchResult[] {
  const results: SearchResult[] = [];
  for (let i = 1; i <= count; i++) {
    if (isPage) {
      results.push({
        path: `/app/blogs/[blog]/page.val.ts?p="/blogs/blog-${i}"` as SourcePath,
        label: `Blog Post ${i}`,
      });
    } else {
      results.push({
        path: `/content/articles.val.ts?p="article-${i}"` as SourcePath,
        label: `Article ${i}`,
      });
    }
  }
  return results;
}

// Helper to create team member search results (list view rendering)
function createTeamResults(count: 0 | 1 | 2 | 3): SearchResult[] {
  const results: SearchResult[] = [];
  for (let i = 1; i <= count; i++) {
    results.push({
      path: `/content/team.val.ts?p="team-${i}"` as SourcePath,
      label: `Team Member ${i}`,
    });
  }
  return results;
}

// Helper to create product page search results (router with list view rendering)
function createProductPageResults(count: 0 | 1 | 2 | 3): SearchResult[] {
  const results: SearchResult[] = [];
  for (let i = 1; i <= count; i++) {
    results.push({
      path: `/app/products/[product]/page.val.ts?p="/products/product-${i}"` as SourcePath,
      label: `Product ${i}`,
    });
  }
  return results;
}

// Helper to create config array item results (array with code rendering)
function createConfigResults(count: 0 | 1 | 2 | 3): SearchResult[] {
  const results: SearchResult[] = [];
  const keys = ["customHook", "apiConfig", "utilFunction"];
  for (let i = 0; i < count; i++) {
    results.push({
      path: `/content/config.val.ts?p=${i}` as SourcePath,
      label: `Config: ${keys[i]}`,
    });
  }
  return results;
}

// Helper to create author search results
function createAuthorResults(
  count: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
): SearchResult[] {
  const results: SearchResult[] = [];
  for (let i = 1; i <= count; i++) {
    results.push({
      path: `/content/authors.val.ts?p="author-${i}"` as SourcePath,
      label: `Author ${i}`,
    });
  }
  return results;
}

// Wrapper component that provides all necessary providers
function SearchResultsListWithProviders({
  results,
  schemas = mockSchemas,
  sources = mockSources as Record<ModuleFilePath, JSONValue | undefined>,
  renders = mockRenders,
}: {
  results: SearchResult[];
  schemas?: Record<ModuleFilePath, SerializedSchema | undefined>;
  sources?: Record<ModuleFilePath, JSONValue | undefined>;
  renders?: Record<ModuleFilePath, ReifiedRender | null>;
}) {
  const client = useMemo(() => createMockClient(), []);
  const [theme, setTheme] = useState<Themes | null>(null);

  // Create syncEngine and initialize with mock data
  const syncEngine = useMemo(() => {
    const engine = new ValSyncEngine(client, undefined);
    engine.setSchemas(schemas);
    engine.setSources(sources);
    engine.setRenders(renders);
    engine.setInitializedAt(Date.now());
    return engine;
  }, [client, schemas, sources, renders]);

  // Mock getDirectFileUploadSettings callback
  const getDirectFileUploadSettings = useMemo(
    () => async () => {
      return {
        status: "success" as const,
        data: {
          nonce: null,
          baseUrl: "https://mock-upload.example.com",
        },
      };
    },
    [],
  );

  // Mock remoteFiles
  const remoteFiles = useMemo(
    () => ({
      status: "inactive" as const,
      message: "Remote files not available in Storybook",
      reason: "project-not-configured" as const,
    }),
    [],
  );

  const handleSelect = (path: SourcePath | ModuleFilePath) => {
    console.log("Selected:", path);
  };

  const loadedSources = useMemo(() => {
    const loadedSources: Record<ModuleFilePath, Json> = {};
    for (const key in sources) {
      if (sources[key as ModuleFilePath] !== undefined) {
        loadedSources[key as ModuleFilePath] = sources[
          key as ModuleFilePath
        ] as Json;
      }
    }
    return loadedSources;
  }, [sources]);
  const loadedSchemas = useMemo(() => {
    const loadedSchemas: Record<ModuleFilePath, SerializedSchema> = {};
    for (const key in schemas) {
      if (schemas[key as ModuleFilePath] !== undefined) {
        loadedSchemas[key as ModuleFilePath] = schemas[
          key as ModuleFilePath
        ] as SerializedSchema;
      }
    }
    return loadedSchemas;
  }, [schemas]);
  return (
    <ValThemeProvider theme={theme} setTheme={setTheme} config={undefined}>
      <ValErrorProvider syncEngine={syncEngine}>
        <ValPortalProvider>
          <ValRemoteProvider remoteFiles={remoteFiles}>
            <ValFieldProvider
              syncEngine={syncEngine}
              getDirectFileUploadSettings={getDirectFileUploadSettings}
              config={undefined}
            >
              <ValRouter>
                <div className="relative w-full max-w-md">
                  <Command shouldFilter={false}>
                    <SearchResultsList
                      results={results}
                      sources={loadedSources}
                      schemas={loadedSchemas}
                      onSelect={handleSelect}
                    />
                  </Command>
                </div>
              </ValRouter>
            </ValFieldProvider>
          </ValRemoteProvider>
        </ValPortalProvider>
      </ValErrorProvider>
    </ValThemeProvider>
  );
}

const meta: Meta<typeof SearchResultsListWithProviders> = {
  title: "Search/SearchResultsList",
  component: SearchResultsListWithProviders,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="min-h-[200px] w-full max-w-2xl mx-auto p-8 bg-bg-primary">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SearchResultsListWithProviders>;

export const LongMixedResults: Story = {
  render: () => {
    const pages = [
      ...createMockSearchResults(5, true),
      ...createProductPageResults(3),
    ];
    const otherResults = [
      ...createMockSearchResults(5, false),
      ...createAuthorResults(4),
      ...createTeamResults(3),
      ...createConfigResults(3),
    ];
    return (
      <SearchResultsListWithProviders results={[...pages, ...otherResults]} />
    );
  },
  name: "Long Set of Mixed Results",
  parameters: {
    docs: {
      description: {
        story:
          "Search results list with a comprehensive mix of all content types: blog pages (5), product pages (3), articles (5), authors (4), team members (3), and config items (3). Demonstrates handling of various render types including list views, code editors, and textareas.",
      },
    },
  },
};

export const ShortMixedResults: Story = {
  render: () => (
    <SearchResultsListWithProviders
      results={[
        ...createMockSearchResults(2, true),
        ...createMockSearchResults(3, false),
      ]}
    />
  ),
  name: "Short Set of Mixed Results",
  parameters: {
    docs: {
      description: {
        story:
          "Search results list with a short set of mixed results - 2 pages and 3 other results.",
      },
    },
  },
};

export const OnlyPages: Story = {
  render: () => (
    <SearchResultsListWithProviders
      results={createMockSearchResults(4, true)}
    />
  ),
  name: "Only Pages",
  parameters: {
    docs: {
      description: {
        story: "Search results list showing only router pages (4 pages).",
      },
    },
  },
};

export const OnlyOtherResults: Story = {
  render: () => (
    <SearchResultsListWithProviders
      results={createMockSearchResults(6, false)}
    />
  ),
  name: "Only Other Results",
  parameters: {
    docs: {
      description: {
        story: "Search results list showing only non-page results (6 results).",
      },
    },
  },
};

export const NoResults: Story = {
  render: () => <SearchResultsListWithProviders results={[]} />,
  name: "No Results",
  parameters: {
    docs: {
      description: {
        story:
          "Search results list showing the empty state when no results are found.",
      },
    },
  },
};

export const TeamMembersWithListView: Story = {
  render: () => (
    <SearchResultsListWithProviders results={createTeamResults(3)} />
  ),
  name: "Team Members (List View Rendering)",
  parameters: {
    docs: {
      description: {
        story:
          "Team members record with list view rendering. Each member displays name as title and position as subtitle. The bio field uses textarea rendering for multiline text.",
      },
    },
  },
};

export const ProductPagesWithListView: Story = {
  render: () => (
    <SearchResultsListWithProviders results={createProductPageResults(3)} />
  ),
  name: "Product Pages (Router + List View)",
  parameters: {
    docs: {
      description: {
        story:
          "Product pages using router with list view rendering. Displays product name and price. The description field uses textarea rendering and the code field uses code editor with JSON syntax highlighting.",
      },
    },
  },
};

export const ConfigWithCodeRendering: Story = {
  render: () => (
    <SearchResultsListWithProviders results={createConfigResults(3)} />
  ),
  name: "Config Items (Array with Code Rendering)",
  parameters: {
    docs: {
      description: {
        story:
          "Configuration array items where the value field uses code editor rendering with TypeScript syntax highlighting, and description uses textarea rendering for multiline text.",
      },
    },
  },
};

export const MixedRenderTypes: Story = {
  render: () => {
    const results = [
      ...createTeamResults(2),
      ...createProductPageResults(2),
      ...createConfigResults(2),
      ...createAuthorResults(2),
    ];
    return <SearchResultsListWithProviders results={results} />;
  },
  name: "Mixed Render Types",
  parameters: {
    docs: {
      description: {
        story:
          "A focused view of items with different render methods: list views (team and products), code editors (config), and textareas. Demonstrates how various render options are handled together.",
      },
    },
  },
};
