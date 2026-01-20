import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  mockNavMenuData,
  mockNavMenuDataSitemapOnly,
  mockNavMenuDataExplorerOnly,
  mockLargeSitemap,
  mockExplorer,
  mockExternal,
} from "../mockData";
import { NavMenuData } from "../types";
import { SitemapSection } from "../SitemapSection";
import { ExplorerSection } from "../ExplorerSection";
import { ExternalButton } from "../ExternalButton";
import { Accordion } from "../../designSystem/accordion";
import { Loader2 } from "lucide-react";
import { AccordionItem } from "@radix-ui/react-accordion";

// Mock NavMenuV2 that renders the actual components without needing providers
function MockedNavMenuV2({
  data,
  isLoading,
}: {
  data: NavMenuData;
  isLoading?: boolean;
}) {
  const [activeSection, setActiveSection] = useState<string | undefined>(
    data.sitemap ? "sitemap" : data.explorer ? "explorer" : undefined,
  );

  const handleNavigate = (path: string) => {
    console.log("Navigate to:", path);
  };

  const handleAddPage = (moduleFilePath: string, urlPath: string) => {
    console.log("Add page:", { moduleFilePath, urlPath });
  };

  const handleExternalClick = () => {
    if (data.external) {
      // Close all accordion sections when external is selected
      setActiveSection(undefined);
      console.log("Navigate to external:", data.external.moduleFilePath);
    }
  };

  // Calculate max content height
  const sectionCount =
    (data.sitemap ? 1 : 0) + (data.explorer ? 1 : 0) + (data.external ? 1 : 0);
  const contentMaxHeight = `calc(600px - 64px - ${sectionCount * 48}px - 80px)`;

  return (
    <div className="h-[600px] w-80 bg-bg-primary border border-border-primary rounded-lg overflow-hidden">
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex gap-4 items-center p-4 h-16 border-b border-border-primary shrink-0">
          <div className="w-4 h-4 rounded bg-fg-secondary" />
          <span className="text-sm">example/project</span>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 size={20} className="animate-spin text-fg-secondary" />
            </div>
          ) : (
            <Accordion
              type="single"
              collapsible
              defaultValue={activeSection}
              onValueChange={(value) => {
                if (value) {
                  setActiveSection("explorer");
                } else {
                  setActiveSection(undefined);
                }
              }}
            >
              {/* Site Map Section */}
              {data.sitemap && (
                <SitemapSection
                  sitemap={data.sitemap}
                  onNavigate={handleNavigate}
                  onAddPage={handleAddPage}
                  maxHeight={contentMaxHeight}
                />
              )}

              {/* External Button - between Site Map and Explorer */}
              {data.external && (
                <AccordionItem value="external" onClick={handleExternalClick}>
                  <ExternalButton
                    external={data.external}
                    isActive={false}
                    onClick={handleExternalClick}
                  />
                </AccordionItem>
              )}

              {/* Explorer Section */}
              {data.explorer && (
                <ExplorerSection
                  explorer={data.explorer}
                  onNavigate={handleNavigate}
                  maxHeight={contentMaxHeight}
                />
              )}
            </Accordion>
          )}
        </div>

        {/* Profile */}
        <div className="shrink-0 p-4 border-t border-border-primary">
          <div className="flex items-center justify-between">
            <div className="w-8 h-8 rounded-full bg-fg-secondary" />
            <span className="text-fg-secondary">...</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const meta: Meta<typeof MockedNavMenuV2> = {
  title: "NavMenuV2/NavMenuV2",
  component: MockedNavMenuV2,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof MockedNavMenuV2>;

export const Default: Story = {
  args: {
    data: mockNavMenuData,
  },
  name: "All Sections",
};

export const SitemapOnly: Story = {
  args: {
    data: mockNavMenuDataSitemapOnly,
  },
  name: "Sitemap Only",
};

export const ExplorerOnly: Story = {
  args: {
    data: mockNavMenuDataExplorerOnly,
  },
  name: "Explorer Only",
};

export const Loading: Story = {
  args: {
    data: mockNavMenuData,
    isLoading: true,
  },
};

export const LargeSitemap: Story = {
  args: {
    data: {
      sitemap: mockLargeSitemap,
      explorer: mockExplorer,
      external: mockExternal,
    },
  },
  name: "Large Sitemap (30 items)",
};
