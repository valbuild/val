import type { Meta, StoryObj } from "@storybook/react";
import { DropdownPreviewRow } from "./DropdownPreviewRow";

const meta: Meta<typeof DropdownPreviewRow> = {
  title: "Components/DropdownPreviewRow",
  component: DropdownPreviewRow,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="mx-auto w-[320px] rounded-md border border-border-primary bg-bg-primary p-2 shadow-lg">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof DropdownPreviewRow>;

export const WithImage: Story = {
  args: {
    title: "Acme Corp",
    subtitle: "https://acme.example.com",
    image: "https://placehold.co/64x64/e2e8f0/475569?text=A",
  },
};

export const WithoutImage: Story = {
  args: {
    title: "Widget Inc",
    subtitle: "https://widget.example.com",
    image: null,
  },
};

export const LongTitle: Story = {
  args: {
    title:
      "An extremely long title that should be truncated when it overflows the available width",
    subtitle:
      "And an equally long subtitle that should also be truncated when shown in a cramped dropdown row",
    image: "https://placehold.co/64x64/dbeafe/1e40af?text=L",
  },
};

export const NoSubtitle: Story = {
  args: {
    title: "Just a title",
    image: "https://placehold.co/64x64/d1fae5/065f46?text=N",
  },
};

export const MixedRows: Story = {
  render: () => (
    <div className="flex flex-col gap-1">
      <DropdownPreviewRow
        title="Has image"
        subtitle="aligned"
        image="https://placehold.co/64x64/e2e8f0/475569?text=1"
      />
      <DropdownPreviewRow title="No image" subtitle="aligned" />
      <DropdownPreviewRow
        title="Has image again"
        subtitle="aligned"
        image="https://placehold.co/64x64/dbeafe/1e40af?text=3"
      />
    </div>
  ),
};

export const MixedRowsNoPlaceholder: Story = {
  render: () => (
    <div className="flex flex-col gap-1">
      <DropdownPreviewRow
        title="Has image"
        subtitle="https://example.com/with-image"
        image="https://placehold.co/64x64/e2e8f0/475569?text=1"
        placeholder={false}
      />
      <DropdownPreviewRow title="/plain-route" placeholder={false} />
      <DropdownPreviewRow
        title="Has image again"
        subtitle="https://example.com/another"
        image="https://placehold.co/64x64/dbeafe/1e40af?text=3"
        placeholder={false}
      />
      <DropdownPreviewRow title="/another-plain" placeholder={false} />
    </div>
  ),
};
