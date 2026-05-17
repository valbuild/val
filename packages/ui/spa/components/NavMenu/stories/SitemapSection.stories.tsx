import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { RoutePattern } from "@valbuild/shared/internal";
import { SitemapSection } from "../SitemapSection";
import { mockSitemap, mockLargeSitemap } from "../mockData";
import { Accordion } from "../../designSystem/accordion";
import { SitemapItem } from "../types";

const meta: Meta<typeof SitemapSection> = {
  title: "NavMenu/SitemapSection",
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
  name: "Default",
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

const catchAllRoutePattern: RoutePattern[] = [
  { type: "literal", name: "docs" },
  { type: "array-param", paramName: "slug", optional: false },
];

const catchAllSitemap: SitemapItem = {
  name: "/",
  urlPath: "/",
  children: [
    {
      name: "docs",
      urlPath: "/docs",
      canAddChild: true,
      moduleFilePath: "/app/docs/[...slug]/page.val.ts" as ModuleFilePath,
      routePattern: catchAllRoutePattern,
      existingKeys: ["/guides/intro", "/api/auth", "/guides/advanced/forms"],
      children: [
        {
          name: "guides/intro",
          urlPath: "/docs/guides/intro",
          sourcePath:
            '/app/docs/[...slug]/page.val.ts?p="/docs/guides/intro"' as SourcePath,
          children: [],
        },
        {
          name: "api/auth",
          urlPath: "/docs/api/auth",
          sourcePath:
            '/app/docs/[...slug]/page.val.ts?p="/docs/api/auth"' as SourcePath,
          children: [],
        },
      ],
    },
  ],
};

export const CatchAllRoute: Story = {
  render: () => (
    <InteractiveSitemapSection
      sitemap={catchAllSitemap}
      onNavigate={(path) => console.log("Navigate to:", path)}
      onAddPage={(moduleFilePath, urlPath) =>
        console.log("Add page:", { moduleFilePath, urlPath })
      }
    />
  ),
  name: "Catch-all route (open New page popover)",
};

const multiSegmentRoutePattern: RoutePattern[] = [
  { type: "literal", name: "shop" },
  { type: "string-param", paramName: "category", optional: false },
  { type: "string-param", paramName: "product", optional: false },
];

const multiSegmentSitemap: SitemapItem = {
  name: "/",
  urlPath: "/",
  children: [
    {
      name: "shop",
      urlPath: "/shop",
      canAddChild: true,
      moduleFilePath:
        "/app/shop/[category]/[product]/page.val.ts" as ModuleFilePath,
      routePattern: multiSegmentRoutePattern,
      existingKeys: ["/electronics"],
      children: [
        {
          name: "electronics",
          urlPath: "/shop/electronics",
          canAddChild: true,
          moduleFilePath:
            "/app/shop/[category]/[product]/page.val.ts" as ModuleFilePath,
          routePattern: multiSegmentRoutePattern,
          existingKeys: ["/phone"],
          children: [
            {
              name: "phone",
              urlPath: "/shop/electronics/phone",
              sourcePath:
                '/app/shop/[category]/[product]/page.val.ts?p="/shop/electronics/phone"' as SourcePath,
              children: [],
            },
          ],
        },
      ],
    },
  ],
};

export const MultiSegmentRoute: Story = {
  render: () => (
    <InteractiveSitemapSection
      sitemap={multiSegmentSitemap}
      onNavigate={(path) => console.log("Navigate to:", path)}
      onAddPage={(moduleFilePath, urlPath) =>
        console.log("Add page:", { moduleFilePath, urlPath })
      }
    />
  ),
  name: "Multi-segment route (/shop/[category]/[product])",
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
