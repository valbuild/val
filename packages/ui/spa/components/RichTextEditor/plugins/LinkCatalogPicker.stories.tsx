import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { LinkCatalogPicker } from "./LinkCatalogPickerComponent";
import type { EditorLinkCatalogItem } from "../types";

const sampleCatalog: EditorLinkCatalogItem[] = [
  {
    title: "Acme Corp",
    subtitle: "https://acme.example.com",
    image: "https://placehold.co/64x64/e2e8f0/475569?text=A",
    href: "https://acme.example.com",
  },
  {
    title: "Widget Inc",
    subtitle: "https://widget.example.com",
    href: "https://widget.example.com",
  },
  {
    title: "Docs Portal",
    subtitle: "Internal documentation hub",
    image: "https://placehold.co/64x64/dbeafe/1e40af?text=D",
    href: "https://docs.example.com",
  },
  {
    title: "Blog",
    subtitle: "https://blog.example.com",
    image: "https://placehold.co/64x64/d1fae5/065f46?text=B",
    href: "https://blog.example.com",
  },
  {
    title: "Support Center",
    subtitle: "https://support.example.com",
    href: "https://support.example.com",
  },
];

const largeCatalog: EditorLinkCatalogItem[] = Array.from(
  { length: 30 },
  (_, i) => ({
    title: `Page ${i + 1}`,
    subtitle: `https://example.com/page-${i + 1}`,
    image: i % 3 === 0 ? `https://placehold.co/64x64?text=${i + 1}` : undefined,
    href: `https://example.com/page-${i + 1}`,
  }),
);

function PickerContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-[320px] rounded-md border border-border-primary bg-bg-primary shadow-lg">
      {children}
    </div>
  );
}

const meta: Meta<typeof LinkCatalogPicker> = {
  title: "RichTextEditor/LinkCatalogPicker",
  component: LinkCatalogPicker,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-md p-4">
        <PickerContainer>
          <Story />
        </PickerContainer>
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof LinkCatalogPicker>;

export const Default: Story = {
  args: {
    catalog: sampleCatalog,
    currentHref: null,
    onApplyLink: (item) => console.log("Apply link:", item),
    onRemoveLink: null,
    onClose: () => console.log("Close"),
  },
};

export const WithSelectedItem: Story = {
  args: {
    catalog: sampleCatalog,
    currentHref: "https://acme.example.com",
    onApplyLink: (item) => console.log("Apply link:", item),
    onRemoveLink: () => console.log("Remove link"),
    onClose: () => console.log("Close"),
  },
};

export const EmptyCatalog: Story = {
  args: {
    catalog: [],
    currentHref: null,
    onApplyLink: (item) => console.log("Apply link:", item),
    onRemoveLink: null,
    onClose: () => console.log("Close"),
  },
};

export const LongCatalog: Story = {
  args: {
    catalog: largeCatalog,
    currentHref: null,
    onApplyLink: (item) => console.log("Apply link:", item),
    onRemoveLink: null,
    onClose: () => console.log("Close"),
  },
};

export const WithRemoveLink: Story = {
  args: {
    catalog: sampleCatalog,
    currentHref: "https://docs.example.com",
    onApplyLink: (item) => console.log("Apply link:", item),
    onRemoveLink: () => console.log("Remove link"),
    onClose: () => console.log("Close"),
  },
};

function InteractiveStory() {
  const [selected, setSelected] = useState<EditorLinkCatalogItem | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <PickerContainer>
        <LinkCatalogPicker
          catalog={sampleCatalog}
          currentHref={selected?.href ?? null}
          onApplyLink={(item) => setSelected(item)}
          onRemoveLink={selected ? () => setSelected(null) : null}
          onClose={() => console.log("Close")}
        />
      </PickerContainer>
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
