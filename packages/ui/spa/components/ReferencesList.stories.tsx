import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { ReferencesList, ReferencesListItem } from "./ReferencesList";

function makeItem(
  index: number,
  opts: { withPreview?: boolean; withImage?: boolean } = {},
): ReferencesListItem {
  const moduleFilePath = `/content/page-${index}.val.ts` as ModuleFilePath;
  const patchPath = ["entries", `item-${index}`];
  const path = `${moduleFilePath}?p="entries"."item-${index}"` as SourcePath;
  return {
    path,
    moduleFilePath,
    patchPath,
    preview: opts.withPreview
      ? {
          title: `Entry ${index}`,
          subtitle: `Linked from page ${index}`,
          image: opts.withImage
            ? `https://placehold.co/64x64/e2e8f0/475569?text=${index}`
            : null,
        }
      : null,
    fallbackLabel: `Page ${index} → entries → item-${index}`,
  };
}

const meta: Meta<typeof ReferencesList> = {
  title: "Components/ReferencesList",
  component: ReferencesList,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="mx-auto w-[360px] rounded-md border border-border-primary bg-bg-primary shadow-lg">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ReferencesList>;

export const Default: Story = {
  args: {
    items: [
      makeItem(1, { withPreview: true, withImage: true }),
      makeItem(2, { withPreview: true, withImage: false }),
      makeItem(3, {}),
      makeItem(4, { withPreview: true, withImage: true }),
    ],
    onSelect: (item) => console.log("Select:", item),
  },
};

export const Empty: Story = {
  args: {
    items: [],
    onSelect: (item) => console.log("Select:", item),
  },
};

export const SingleRef: Story = {
  args: {
    items: [makeItem(1, { withPreview: true, withImage: true })],
    onSelect: (item) => console.log("Select:", item),
  },
};

export const ManyRefs: Story = {
  args: {
    items: Array.from({ length: 25 }, (_, i) =>
      makeItem(i + 1, {
        withPreview: i % 2 === 0,
        withImage: i % 3 === 0,
      }),
    ),
    onSelect: (item) => console.log("Select:", item),
  },
};

export const WithCurrentPath: Story = {
  args: {
    items: [
      makeItem(1, { withPreview: true, withImage: true }),
      makeItem(2, { withPreview: true, withImage: false }),
      makeItem(3, { withPreview: true, withImage: true }),
    ],
    currentPath: `/content/page-2.val.ts?p="entries"."item-2"` as SourcePath,
    onSelect: (item) => console.log("Select:", item),
  },
};

function InteractiveStory() {
  const [selected, setSelected] = useState<ReferencesListItem | null>(null);
  const items = [
    makeItem(1, { withPreview: true, withImage: true }),
    makeItem(2, { withPreview: true, withImage: false }),
    makeItem(3, {}),
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border-primary bg-bg-primary shadow-lg">
        <ReferencesList
          items={items}
          currentPath={selected?.path ?? null}
          onSelect={setSelected}
        />
      </div>
      <div className="rounded border border-border-secondary bg-bg-secondary p-3">
        <div className="text-sm font-bold text-fg-secondary">Selected</div>
        <pre className="mt-1 text-xs text-fg-secondary-alt">
          {selected ? JSON.stringify(selected, null, 2) : "(none)"}
        </pre>
      </div>
    </div>
  );
}

export const Interactive: Story = {
  render: () => <InteractiveStory />,
};
