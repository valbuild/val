import type { Meta, StoryObj } from "@storybook/react";
import React, { useMemo, useState } from "react";
import {
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import { ValRouter } from "../../ValRouter";
import { SearchItem } from "../../SearchItem";
import { mockSchemas, mockSources } from "./mockData";
import { ValSyncEngine } from "../../../ValSyncEngine";
import { ValThemeProvider, Themes } from "../../ValThemeProvider";
import { ValErrorProvider } from "../../ValErrorProvider";
import { ValPortalProvider } from "../../ValPortalProvider";
import { ValRemoteProvider } from "../../ValRemoteProvider";
import { ValFieldProvider } from "../../ValFieldProvider";
import { ValClient } from "@valbuild/shared/internal";

// Create a minimal mock ValClient for Storybook
function createMockClient(): ValClient {
  // Return a minimal client that satisfies the interface
  return (async (path, method, req) => {
    // Mock client that returns basic responses
    return {
      status: 200,
      json: async () => ({
        schemas: mockSchemas,
        sources: mockSources,
        config: { project: "storybook-test" },
      }),
    } as any;
  }) as ValClient;
}

// Wrapper component that provides mock providers
function SearchItemWithProviders({
  path,
  url,
  schemas = mockSchemas,
  sources = mockSources as Record<ModuleFilePath, JSONValue | undefined>,
}: {
  path: SourcePath;
  url: string | null;
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
    []
  );

  // Mock remoteFiles
  const remoteFiles = useMemo(
    () => ({
      status: "inactive" as const,
      message: "Remote files not available in Storybook",
      reason: "project-not-configured" as const,
    }),
    []
  );

  console.log("SearchItemWithProviders", sources);

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
                <div className="w-full max-w-md p-4">
                  <div className="rounded-lg border border-border-primary p-3 bg-bg-primary">
                    <SearchItem path={path} url={url} />
                  </div>
                </div>
              </ValRouter>
            </ValFieldProvider>
          </ValRemoteProvider>
        </ValPortalProvider>
      </ValErrorProvider>
    </ValThemeProvider>
  );
}

const meta: Meta<typeof SearchItemWithProviders> = {
  title: "Search/SearchItem",
  component: SearchItemWithProviders,
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
type Story = StoryObj<typeof SearchItemWithProviders>;

export const WithUrl: Story = {
  render: () => (
    <SearchItemWithProviders
      path={'/app/blogs/[blog]/page.val.ts?p="/blogs/blog-1"' as SourcePath}
      url="/blogs/blog-1"
    />
  ),
  name: "With URL (Router Page)",
  parameters: {
    docs: {
      description: {
        story:
          "SearchItem for a router page result. Shows a Globe icon and the URL.",
      },
    },
  },
};

export const WithoutUrl: Story = {
  render: () => (
    <SearchItemWithProviders
      path={'/content/settings.val.ts?p="siteName"' as SourcePath}
      url={null}
    />
  ),
  name: "Without URL (Regular Content)",
  parameters: {
    docs: {
      description: {
        story:
          "SearchItem for regular content. Uses the Preview component to display the content.",
      },
    },
  },
};

export const StringContent: Story = {
  render: () => (
    <SearchItemWithProviders
      path={'/content/settings.val.ts?p="siteName"' as SourcePath}
      url={null}
    />
  ),
  name: "String Content",
};

export const RichTextContent: Story = {
  render: () => (
    <SearchItemWithProviders
      path={
        '/app/blogs/[blog]/page.val.ts?p="/blogs/blog-1".content' as SourcePath
      }
      url={null}
    />
  ),
  name: "RichText Content",
};
