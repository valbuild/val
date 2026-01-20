import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { SitemapSection } from "../SitemapSection";
import { mockSitemap, mockLargeSitemap } from "../mockData";
import { Accordion } from "../../designSystem/accordion";

const meta: Meta<typeof SitemapSection> = {
  title: "NavMenuV2/SitemapSection",
  component: SitemapSection,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-80 bg-bg-primary border border-border-primary rounded-lg overflow-hidden">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SitemapSection>;

// Interactive wrapper to handle state with Accordion
function InteractiveSitemapSection({
  defaultExpanded = true,
  ...props
}: React.ComponentProps<typeof SitemapSection> & {
  defaultExpanded?: boolean;
}) {
  const [value, setValue] = useState(defaultExpanded ? "sitemap" : "");
  return (
    <Accordion type="single" collapsible value={value} onValueChange={setValue}>
      <SitemapSection {...props} />
    </Accordion>
  );
}

export const Default: Story = {
  render: () => (
    <InteractiveSitemapSection
      sitemap={mockSitemap}
      onNavigate={(path) => console.log("Navigate to:", path)}
      onAddPage={(moduleFilePath, urlPath) =>
        console.log("Add page:", { moduleFilePath, urlPath })
      }
    />
  ),
  name: "Default (with Add button)",
};

export const Collapsed: Story = {
  render: () => (
    <InteractiveSitemapSection
      sitemap={mockSitemap}
      defaultExpanded={false}
      onNavigate={(path) => console.log("Navigate to:", path)}
    />
  ),
};

export const WithActivePath: Story = {
  render: () => (
    <InteractiveSitemapSection
      sitemap={mockSitemap}
      currentPath='/app/blogs/[blog]/page.val.ts?p="/blogs/blog-2"'
      onNavigate={(path) => console.log("Navigate to:", path)}
      onAddPage={(moduleFilePath, urlPath) =>
        console.log("Add page:", { moduleFilePath, urlPath })
      }
    />
  ),
};

export const LargeSitemap: Story = {
  render: () => (
    <InteractiveSitemapSection
      sitemap={mockLargeSitemap}
      maxHeight="300px"
      onNavigate={(path) => console.log("Navigate to:", path)}
      onAddPage={(moduleFilePath, urlPath) =>
        console.log("Add page:", { moduleFilePath, urlPath })
      }
    />
  ),
};
