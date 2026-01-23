import type { Meta, StoryObj } from "@storybook/react";
import React, { useState } from "react";
import {
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { SearchField } from "../../Search";
import { mockSchemas, mockSources } from "./mockData";
import { Search as SearchIcon } from "lucide-react";

// Wrapper component that provides active/inactive state for stories
function SearchWithState({
  schemas = mockSchemas,
  sources = mockSources,
}: {
  schemas?: Record<ModuleFilePath, SerializedSchema>;
  sources?: Record<ModuleFilePath, Json>;
}) {
  const [isActive, setIsActive] = useState(false);

  const handleSelect = (path: SourcePath | ModuleFilePath) => {
    console.log("Selected path:", path);
    setIsActive(false);
  };

  if (!isActive) {
    return (
      <div className="relative w-full overflow-visible">
        <div
          className="rounded-lg border border-border-primary shadow-sm overflow-visible cursor-text"
          onClick={() => setIsActive(true)}
          onFocus={() => setIsActive(true)}
          tabIndex={0}
        >
          <div className="flex items-center px-3 h-11">
            <SearchIcon className="w-4 h-4 mr-2 opacity-50 shrink-0" />
            <input
              className="flex h-full w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-fg-secondary cursor-text"
              placeholder="Search content..."
              readOnly
              onFocus={() => setIsActive(true)}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <SearchField
      sources={sources}
      schemas={schemas}
      onSelect={handleSelect}
      onDeactivate={() => setIsActive(false)}
    />
  );
}

const meta: Meta<typeof SearchWithState> = {
  title: "Search/Search",
  component: SearchWithState,
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
type Story = StoryObj<typeof SearchWithState>;

export const Default: Story = {
  render: () => (
    <div>
      <p className="mb-4 text-sm text-fg-secondary">
        Default inactive state. Click the search input to activate.
      </p>
      <SearchWithState />
    </div>
  ),
  name: "Default (Inactive)",
};

export const WithMockData: Story = {
  render: () => (
    <div>
      <p className="mb-4 text-sm text-fg-secondary">
        Search component with mock data. Click to activate, then try searching
        for: "blog", "article", "author", "documentation", or "settings".
      </p>
      <SearchWithState />
    </div>
  ),
  name: "With Mock Data",
};

export const EmptyState: Story = {
  render: () => (
    <div>
      <p className="mb-4 text-sm text-fg-secondary">
        Search with no data. Click to activate search.
      </p>
      <SearchWithState schemas={{}} sources={{}} />
    </div>
  ),
  name: "Empty State",
};
