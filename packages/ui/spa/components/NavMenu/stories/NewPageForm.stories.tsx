import type { Meta, StoryObj } from "@storybook/react";
import { ModuleFilePath } from "@valbuild/core";
import { RoutePattern } from "@valbuild/shared/internal";
import { NewPageForm, AvailableRoute } from "../NewPageForm";

const meta: Meta<typeof NewPageForm> = {
  title: "NavMenu/NewPageForm",
  component: NewPageForm,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-80 bg-bg-primary border border-border-primary rounded-md overflow-hidden">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof NewPageForm>;

const blogsPattern: RoutePattern[] = [
  { type: "literal", name: "blogs" },
  { type: "string-param", paramName: "blog", optional: false },
];

const docsPattern: RoutePattern[] = [
  { type: "literal", name: "docs" },
  { type: "array-param", paramName: "slug", optional: false },
];

const shopPattern: RoutePattern[] = [
  { type: "literal", name: "shop" },
  { type: "string-param", paramName: "category", optional: false },
  { type: "string-param", paramName: "product", optional: false },
];

const blogsRoute: AvailableRoute = {
  moduleFilePath: "/app/blogs/[blog]/page.val.ts" as ModuleFilePath,
  routePattern: blogsPattern,
  patternString: "/blogs/[blog]",
  existingKeys: ["/blogs/blog-1", "/blogs/blog-2"],
};

const docsRoute: AvailableRoute = {
  moduleFilePath: "/app/docs/[...slug]/page.val.ts" as ModuleFilePath,
  routePattern: docsPattern,
  patternString: "/docs/[...slug]",
  existingKeys: ["/docs/guides/intro"],
};

const shopRoute: AvailableRoute = {
  moduleFilePath:
    "/app/shop/[category]/[product]/page.val.ts" as ModuleFilePath,
  routePattern: shopPattern,
  patternString: "/shop/[category]/[product]",
  existingKeys: ["/shop/electronics/phone"],
};

export const SingleDynamicSegment: Story = {
  render: () => (
    <NewPageForm
      routes={[blogsRoute]}
      onSubmit={(moduleFilePath, urlPath) =>
        console.log("Create:", { moduleFilePath, urlPath })
      }
      onCancel={() => console.log("Cancel")}
    />
  ),
};

export const CatchAllSegment: Story = {
  render: () => (
    <NewPageForm
      routes={[docsRoute]}
      onSubmit={(moduleFilePath, urlPath) =>
        console.log("Create:", { moduleFilePath, urlPath })
      }
      onCancel={() => console.log("Cancel")}
    />
  ),
};

export const MultipleSegments: Story = {
  render: () => (
    <NewPageForm
      routes={[shopRoute]}
      onSubmit={(moduleFilePath, urlPath) =>
        console.log("Create:", { moduleFilePath, urlPath })
      }
      onCancel={() => console.log("Cancel")}
    />
  ),
};

export const MultipleRoutes: Story = {
  render: () => (
    <NewPageForm
      routes={[blogsRoute, docsRoute, shopRoute]}
      onSubmit={(moduleFilePath, urlPath) =>
        console.log("Create:", { moduleFilePath, urlPath })
      }
      onCancel={() => console.log("Cancel")}
    />
  ),
  name: "Multiple routes (shows dropdown)",
};
