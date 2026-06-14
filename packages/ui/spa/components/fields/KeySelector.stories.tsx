import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { KeyPreview, KeySelector } from "./KeyOfField";

const recordKeys = ["home", "about", "blog", "contact", "team"];

const recordPreviews: Record<string, KeyPreview> = {
  home: {
    title: "Home",
    subtitle: "Landing page",
    image: "https://placehold.co/64x64/e2e8f0/475569?text=H",
  },
  about: {
    title: "About us",
    subtitle: "Company information",
    image: "https://placehold.co/64x64/dbeafe/1e40af?text=A",
  },
  blog: {
    title: "Blog",
    subtitle: "Latest posts",
    image: null,
  },
  contact: {
    title: "Contact",
    subtitle: "Get in touch",
    image: "https://placehold.co/64x64/d1fae5/065f46?text=C",
  },
  team: {
    title: "Team",
    subtitle: "Meet the team",
    image: null,
  },
};

const objectKeys = ["title", "description", "footer"];

const meta: Meta<typeof KeySelector> = {
  title: "Fields/KeySelector",
  component: KeySelector,
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
type Story = StoryObj<typeof KeySelector>;

export const Default: Story = {
  args: {
    keys: recordKeys,
    previews: recordPreviews,
    value: null,
    onChange: (key) => console.log("Select key:", key),
  },
};

export const WithSelectedKey: Story = {
  args: {
    keys: recordKeys,
    previews: recordPreviews,
    value: "home",
    onChange: (key) => console.log("Select key:", key),
  },
};

export const WithoutPreviews: Story = {
  args: {
    keys: objectKeys,
    value: null,
    onChange: (key) => console.log("Select key:", key),
  },
};

export const Loading: Story = {
  args: {
    keys: [],
    value: null,
    isLoading: true,
    onChange: (key) => console.log("Select key:", key),
  },
};

export const EmptyKeys: Story = {
  args: {
    keys: [],
    value: null,
    onChange: (key) => console.log("Select key:", key),
  },
};

function InteractiveStory() {
  const [value, setValue] = useState<string | null>(null);
  return (
    <KeySelector
      keys={recordKeys}
      previews={recordPreviews}
      value={value}
      onChange={(key) => setValue(key)}
    />
  );
}

export const Interactive: Story = {
  render: () => <InteractiveStory />,
};
