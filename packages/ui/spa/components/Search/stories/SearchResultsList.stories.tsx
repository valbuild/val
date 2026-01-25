import type { Meta, StoryObj } from "@storybook/react";
import { useMemo, useState } from "react";
import {
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import { SearchResultsList, type SearchResult } from "../../SearchResultsList";
import { Command } from "../../designSystem/command";
import { mockSchemas, mockSources } from "./mockData";
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

// Wrapper component that provides all necessary providers
function SearchResultsListWithProviders({
  pages,
  otherResults,
  results,
  schemas = mockSchemas,
  sources = mockSources as Record<ModuleFilePath, JSONValue | undefined>,
}: {
  pages: SearchResult[];
  otherResults: SearchResult[];
  results: SearchResult[];
  schemas?: Record<ModuleFilePath, SerializedSchema | undefined>;
  sources?: Record<ModuleFilePath, JSONValue | undefined>;
}) {
  const client = useMemo(() => createMockClient(), []);
  const [theme, setTheme] = useState<Themes | null>(null);

  // Create syncEngine and initialize with mock data
  const syncEngine = useMemo(() => {
    const engine = new ValSyncEngine(client, undefined);
    engine.setSchemas(schemas);
    engine.setSources(sources);
    engine.setInitializedAt(Date.now());
    return engine;
  }, [client, schemas, sources]);

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
                      pages={pages}
                      otherResults={otherResults}
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
  render: () => (
    <SearchResultsListWithProviders
      pages={createMockSearchResults(5, true)}
      otherResults={createMockSearchResults(8, false)}
      results={[
        ...createMockSearchResults(5, true),
        ...createMockSearchResults(8, false),
      ]}
    />
  ),
  name: "Long Set of Mixed Results",
  parameters: {
    docs: {
      description: {
        story:
          "Search results list with a long set of mixed results - 5 pages and 8 other results.",
      },
    },
  },
};

export const ShortMixedResults: Story = {
  render: () => (
    <SearchResultsListWithProviders
      pages={createMockSearchResults(2, true)}
      otherResults={createMockSearchResults(3, false)}
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
      pages={createMockSearchResults(4, true)}
      otherResults={[]}
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
      pages={[]}
      otherResults={createMockSearchResults(6, false)}
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
  render: () => (
    <SearchResultsListWithProviders pages={[]} otherResults={[]} results={[]} />
  ),
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
