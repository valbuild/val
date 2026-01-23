import type { Meta, StoryObj } from "@storybook/react";
import { useMemo, useState } from "react";
import { ModuleFilePath, SerializedSchema } from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import { Search } from "../../Search";
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
  // Return a minimal client that satisfies the interface
  return (async () => {
    // Mock client that returns basic responses
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

// Wrapper component that provides all necessary providers
function SearchWithProviders({
  schemas = mockSchemas,
  sources = mockSources as Record<ModuleFilePath, JSONValue | undefined>,
}: {
  schemas?: Record<ModuleFilePath, SerializedSchema | undefined>;
  sources?: Record<ModuleFilePath, JSONValue | undefined>;
}) {
  const client = useMemo(() => createMockClient(), []);
  const [theme, setTheme] = useState<Themes | null>(null);

  // Create syncEngine and initialize with mock data
  const syncEngine = useMemo(() => {
    const engine = new ValSyncEngine(client, undefined);
    // Use setSchemas and setSources to initialize with mock data
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
                <Search />
              </ValRouter>
            </ValFieldProvider>
          </ValRemoteProvider>
        </ValPortalProvider>
      </ValErrorProvider>
    </ValThemeProvider>
  );
}

const meta: Meta<typeof SearchWithProviders> = {
  title: "Search/Search",
  component: SearchWithProviders,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="min-h-[400px] w-full max-w-2xl mx-auto p-8 bg-bg-primary">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SearchWithProviders>;

export const Default: Story = {
  render: () => (
    <div>
      <p className="mb-4 text-sm text-fg-secondary">
        Default inactive state. Press Cmd+K (Mac) or Ctrl+K to activate search.
      </p>
      <SearchWithProviders />
    </div>
  ),
  name: "Default (Inactive)",
};

export const WithMockData: Story = {
  render: () => (
    <div>
      <p className="mb-4 text-sm text-fg-secondary">
        Search component with mock data. Press Cmd+K (Mac) or Ctrl+K to
        activate, then try searching for: "blog", "article", "author",
        "documentation", or "settings".
      </p>
      <SearchWithProviders />
    </div>
  ),
  name: "With Mock Data",
};

export const EmptyState: Story = {
  render: () => (
    <div>
      <p className="mb-4 text-sm text-fg-secondary">
        Search with no data. Press Cmd+K (Mac) or Ctrl+K to activate search.
      </p>
      <SearchWithProviders schemas={{}} sources={{}} />
    </div>
  ),
  name: "Empty State",
};
