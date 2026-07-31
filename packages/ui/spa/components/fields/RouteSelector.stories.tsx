import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { RouteSelector, RouteSelectorRoute } from "./RouteField";

const sampleRoutes: RouteSelectorRoute[] = [
  {
    route: "/home",
    moduleFilePath: "/content/pages.val.ts",
    preview: {
      title: "Home",
      subtitle: "Landing page",
      image: "https://placehold.co/64x64/e2e8f0/475569?text=H",
    },
  },
  {
    route: "/about",
    moduleFilePath: "/content/pages.val.ts",
    preview: {
      title: "About us",
      subtitle: "Team page",
      image: null,
    },
  },
  {
    route: "/blog/hello-world",
    moduleFilePath: "/content/blog.val.ts",
    preview: null,
  },
  {
    route: "/blog/another-post",
    moduleFilePath: "/content/blog.val.ts",
    preview: {
      title: "Another post",
      subtitle: "https://blog.example.com/another-post",
      image: "https://placehold.co/64x64/dbeafe/1e40af?text=B",
    },
  },
];

const meta: Meta<typeof RouteSelector> = {
  title: "Components/RouteSelector",
  component: RouteSelector,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="mx-auto w-[360px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof RouteSelector>;

export const Default: Story = {
  args: {
    routes: sampleRoutes,
    value: null,
    onChange: (route) => console.log("Select route:", route),
  },
};

export const WithSelectedRoute: Story = {
  args: {
    routes: sampleRoutes,
    value: "/home",
    onChange: (route) => console.log("Select route:", route),
  },
};

export const WithIncludePattern: Story = {
  args: {
    routes: sampleRoutes,
    value: null,
    includePattern: /^\/blog\//,
    onChange: (route) => console.log("Select route:", route),
  },
};

export const WithExcludePattern: Story = {
  args: {
    routes: sampleRoutes,
    value: null,
    excludePattern: /^\/blog\//,
    onChange: (route) => console.log("Select route:", route),
  },
};

export const Empty: Story = {
  args: {
    routes: [],
    value: null,
    onChange: (route) => console.log("Select route:", route),
  },
};

export const Loading: Story = {
  args: {
    routes: [],
    value: null,
    isLoading: true,
    onChange: (route) => console.log("Select route:", route),
  },
};

function InteractiveStory() {
  const [value, setValue] = useState<string | null>(null);
  return (
    <RouteSelector
      routes={sampleRoutes}
      value={value}
      onChange={(route) => setValue(route)}
    />
  );
}

export const Interactive: Story = {
  render: () => <InteractiveStory />,
};
