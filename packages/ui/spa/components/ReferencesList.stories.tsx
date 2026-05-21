import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { ReferencesList, ReferencesListItem } from "./ReferencesList";

// Non-router reference: a record (`authors`) keyed by an id, pointing at a field inside.
function makeItem(
  index: number,
  opts: { withImage?: boolean } = {},
): ReferencesListItem {
  const moduleFilePath = `/content/authors.val.ts` as ModuleFilePath;
  const patchPath = [`author-${index}`, "name"];
  const path = `${moduleFilePath}?p="author-${index}"."name"` as SourcePath;
  return {
    path,
    moduleFilePath,
    isRouter: false,
    preview: opts.withImage
      ? {
          title: `Author ${index}`,
          image: `https://placehold.co/64x64/e2e8f0/475569?text=${index}`,
        }
      : null,
    patchPath,
    fallbackLabel: `author-${index} name`,
  };
}

// Router reference: a `s.record().router()` module keyed by a route, pointing at a field.
function makeRouterItem(
  index: number,
  opts: { withImage?: boolean; field?: string[] } = {},
): ReferencesListItem {
  const moduleFilePath = `/app/blogs/[blog]/page.val.ts` as ModuleFilePath;
  const route = `/blogs/blog-${index}`;
  const field = opts.field ?? ["title"];
  const patchPath = [route, ...field];
  const fieldPath = field.map((f) => `"${f}"`).join(".");
  const path = `${moduleFilePath}?p="${route}".${fieldPath}` as SourcePath;
  return {
    path,
    moduleFilePath,
    isRouter: true,
    preview: opts.withImage
      ? {
          title: `Blog ${index}`,
          image: `https://placehold.co/64x64/e2e8f0/475569?text=${index}`,
        }
      : null,
    patchPath,
    fallbackLabel: `${route} ${field.join(" ")}`,
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

// Non-router record references: key shown verbatim, field nested after a chevron.
export const NonRouterRefs: Story = {
  args: {
    items: [
      makeItem(1, { withImage: true }),
      makeItem(2, {}),
      makeItem(3, { withImage: true }),
    ],
    onSelect: (item) => console.log("Select:", item),
  },
};

// Router references: the route key renders as a `/`-path; the field is nested after it.
export const RouterRefs: Story = {
  args: {
    items: [
      makeRouterItem(1, { withImage: true }),
      makeRouterItem(2, { field: ["author"] }),
      makeRouterItem(3, { field: ["content", "blocks"] }),
    ],
    onSelect: (item) => console.log("Select:", item),
  },
};

// Mixed router + non-router references in one list.
export const Mixed: Story = {
  args: {
    items: [
      makeRouterItem(1, { withImage: true }),
      makeItem(2, { withImage: true }),
      makeRouterItem(3, { field: ["content", "blocks"] }),
      makeItem(4, {}),
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
    items: [makeRouterItem(1, { withImage: true })],
    onSelect: (item) => console.log("Select:", item),
  },
};

export const ManyRefs: Story = {
  args: {
    items: Array.from({ length: 25 }, (_, i) =>
      i % 2 === 0
        ? makeRouterItem(i + 1, { withImage: i % 3 === 0 })
        : makeItem(i + 1, { withImage: i % 3 === 0 }),
    ),
    onSelect: (item) => console.log("Select:", item),
  },
};

// A deeply nested router module + long route/field path, to exercise wrapping.
function makeLongItem(
  index: number,
  opts: { withImage?: boolean } = {},
): ReferencesListItem {
  const moduleFilePath =
    `/app/marketing/campaigns/2026/spring/landing-pages/[locale]/page.val.ts` as ModuleFilePath;
  const route = `/marketing/campaigns/2026/spring/landing-pages/en-us-${index}`;
  const field = ["sections", "featured", "primaryCallToActionButtonLabel"];
  const patchPath = [route, ...field];
  const path =
    `${moduleFilePath}?p="${route}"."sections"."featured"."primaryCallToActionButtonLabel"` as SourcePath;
  return {
    path,
    moduleFilePath,
    isRouter: true,
    preview: opts.withImage
      ? {
          title: `Spring campaign ${index}`,
          image: `https://placehold.co/64x64/e2e8f0/475569?text=${index}`,
        }
      : null,
    patchPath,
    fallbackLabel: `${route} ${field.join(" ")}`,
  };
}

export const LongRefs: Story = {
  args: {
    items: [
      makeLongItem(1, { withImage: true }),
      makeLongItem(2, {}),
      makeLongItem(3, {}),
    ],
    onSelect: (item) => console.log("Select:", item),
  },
};

export const WithCurrentPath: Story = {
  args: {
    items: [
      makeRouterItem(1, { withImage: true }),
      makeRouterItem(2, { field: ["author"] }),
      makeItem(3, { withImage: true }),
    ],
    currentPath:
      `/app/blogs/[blog]/page.val.ts?p="/blogs/blog-2"."author"` as SourcePath,
    onSelect: (item) => console.log("Select:", item),
  },
};

function InteractiveStory() {
  const [selected, setSelected] = useState<ReferencesListItem | null>(null);
  const items = [
    makeRouterItem(1, { withImage: true }),
    makeItem(2, { withImage: true }),
    makeRouterItem(3, { field: ["content", "blocks"] }),
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
