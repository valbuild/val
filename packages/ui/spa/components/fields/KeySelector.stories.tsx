import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { KeyPreview, KeySelector } from "./KeyOfField";
import { placeholderImage } from "../stories/placeholderAssets";

const recordKeys = ["home", "about", "blog", "contact", "team"];

const recordPreviews: Record<string, KeyPreview> = {
  home: {
    title: "Home",
    subtitle: "Landing page",
    image: placeholderImage({
      width: 64,
      height: 64,
      bg: "#e2e8f0",
      fg: "#475569",
      text: "H",
    }),
  },
  about: {
    title: "About us",
    subtitle: "Company information",
    image: placeholderImage({
      width: 64,
      height: 64,
      bg: "#dbeafe",
      fg: "#1e40af",
      text: "A",
    }),
  },
  blog: {
    title: "Blog",
    subtitle: "Latest posts",
    image: null,
  },
  contact: {
    title: "Contact",
    subtitle: "Get in touch",
    image: placeholderImage({
      width: 64,
      height: 64,
      bg: "#d1fae5",
      fg: "#065f46",
      text: "C",
    }),
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

/**
 * Referencing something that does not exist yet: the dropdown can add the entry
 * to the referenced record, which only a record can take - an object's keys are
 * its schema. Search for a key that is not there, and the create option is
 * still offered, with what was searched for as the new key.
 */
function CreatableStory() {
  const [keys, setKeys] = useState(recordKeys);
  const [value, setValue] = useState<string | null>(null);
  return (
    <KeySelector
      keys={keys}
      previews={recordPreviews}
      value={value}
      onChange={(key) => setValue(key)}
      keyDescription="A short, unique id for the page"
      // In the Studio this also writes the entry to the referenced module and
      // navigates to it - `onCreate` owns the whole outcome, so a story that
      // only has a list to add to does both of the parts it has.
      onCreate={(key) => {
        setKeys((prev) => [...prev, key]);
        setValue(key);
      }}
    />
  );
}

export const Creatable: Story = {
  render: () => <CreatableStory />,
};

/**
 * A reference into a record of 10,000 entries, the first hundred of them
 * named by a preview. Only the options on screen are rendered: search for
 * `9999`, or press End, and the list goes there.
 */
function TenThousandKeysStory() {
  const [value, setValue] = useState<string | null>("post-7000");
  return (
    <KeySelector
      keys={manyKeys}
      previews={manyPreviews}
      value={value}
      onChange={(key) => setValue(key)}
    />
  );
}
const manyKeys = Array.from({ length: 10_000 }, (_, i) => `post-${i}`);
const manyPreviews: Record<string, KeyPreview> = Object.fromEntries(
  manyKeys
    .slice(0, 100)
    .map((key, i) => [
      key,
      { title: `Post number ${i}`, subtitle: key, image: null },
    ]),
);

export const TenThousandKeys: Story = {
  render: () => <TenThousandKeysStory />,
};
