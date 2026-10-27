import type { Meta, StoryObj } from "@storybook/react";
import { DropdownPreviewRow } from "./DropdownPreviewRow";
import { placeholderImage } from "./stories/placeholderAssets";

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
    image: placeholderImage({
      width: 64,
      height: 64,
      bg: "#e2e8f0",
      fg: "#475569",
      text: "A",
    }),
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
    image: placeholderImage({
      width: 64,
      height: 64,
      bg: "#dbeafe",
      fg: "#1e40af",
      text: "L",
    }),
  },
};

export const NoSubtitle: Story = {
  args: {
    title: "Just a title",
    image: placeholderImage({
      width: 64,
      height: 64,
      bg: "#d1fae5",
      fg: "#065f46",
      text: "N",
    }),
  },
};

export const MixedRows: Story = {
  render: () => (
    <div className="flex flex-col gap-1">
      <DropdownPreviewRow
        title="Has image"
        subtitle="aligned"
        image={placeholderImage({
          width: 64,
          height: 64,
          bg: "#e2e8f0",
          fg: "#475569",
          text: "1",
        })}
      />
      <DropdownPreviewRow title="No image" subtitle="aligned" />
      <DropdownPreviewRow
        title="Has image again"
        subtitle="aligned"
        image={placeholderImage({
          width: 64,
          height: 64,
          bg: "#dbeafe",
          fg: "#1e40af",
          text: "3",
        })}
      />
      <DropdownPreviewRow title="No image again" subtitle="aligned" />
    </div>
  ),
};
