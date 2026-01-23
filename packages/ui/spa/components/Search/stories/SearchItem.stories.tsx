import type { Meta, StoryObj } from "@storybook/react";
import React, { useMemo, useState } from "react";
import {
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { ValProvider } from "../../ValProvider";
import { ValRouter } from "../../ValRouter";
import { SearchItem } from "../../SearchItem";
import { mockSchemas, mockSources } from "./mockData";
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
  sources = mockSources,
}: {
  path: SourcePath;
  url: string | null;
  schemas?: Record<ModuleFilePath, SerializedSchema>;
  sources?: Record<ModuleFilePath, Json>;
}) {
  const client = useMemo(() => createMockClient(), []);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  return (
    <ValProvider
      client={client}
      dispatchValEvents={false}
      config={null}
    >
      <ValRouter>
        <div className="w-full max-w-md p-4">
          <div className="rounded-lg border border-border-primary p-3 bg-bg-primary">
            <SearchItem path={path} url={url} />
          </div>
        </div>
      </ValRouter>
    </ValProvider>
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

export const ImageContent: Story = {
  render: () => (
    <SearchItemWithProviders
      path={'/content/settings.val.ts?p="featuredImage"' as SourcePath}
      url={null}
    />
  ),
  name: "Image Content",
};
