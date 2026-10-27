import type { Meta, StoryObj } from "@storybook/react";
import { ColorFormat, COLOR_FORMATS, Internal } from "@valbuild/core";
import { useState } from "react";
import { ColorFieldPure } from "./ColorField";

const meta: Meta<typeof ColorFieldPure> = {
  title: "Fields/ColorField",
  component: ColorFieldPure,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="p-8 bg-bg-primary flex items-start min-h-[120px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ColorFieldPure>;

function Wrapper(props: {
  initial?: string | null;
  format?: ColorFormat;
  alpha?: boolean;
  readonly?: boolean;
}) {
  const [value, setValue] = useState<string | null>(props.initial ?? null);
  return (
    <div className="flex flex-col gap-2 w-[420px]">
      <ColorFieldPure
        value={value}
        onChange={setValue}
        format={props.format}
        alpha={props.alpha}
        readonly={props.readonly}
      />
      <code className="text-xs text-fg-tertiary">{value ?? "<empty>"}</code>
    </div>
  );
}

export const Empty: Story = {
  name: "Empty (no value)",
  render: () => <Wrapper initial={null} />,
};

export const Default: Story = {
  name: "Default format (hsl)",
  render: () => <Wrapper initial="hsl(217.22 91.22% 59.8%)" />,
};

export const Hex: Story = {
  name: "format: hex",
  render: () => <Wrapper initial="#3b82f6" format="hex" />,
};

export const Rgb: Story = {
  name: "format: rgb",
  render: () => <Wrapper initial="rgb(59 130 246)" format="rgb" />,
};

export const Oklch: Story = {
  name: "format: oklch",
  render: () => <Wrapper initial="oklch(0.6231 0.188 259.81)" format="oklch" />,
};

export const WithAlpha: Story = {
  name: "alpha: true",
  render: () => <Wrapper initial="hsl(217.22 91.22% 59.8% / 0.5)" alpha />,
};

export const Readonly: Story = {
  name: "Readonly",
  render: () => <Wrapper initial="#3b82f6" format="hex" readonly />,
};

export const Invalid: Story = {
  name: "Unparseable value",
  render: () => <Wrapper initial="rebeccapurple" format="hex" />,
};

export const AllFormats: Story = {
  name: "The same color in every format",
  render: () => (
    <div className="flex flex-col gap-6 w-[420px]">
      {COLOR_FORMATS.map((format) => (
        <div key={format} className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-fg-tertiary">
            {format}
          </span>
          <Wrapper
            initial={Internal.color.convertColor("#3b82f6", format)}
            format={format}
          />
        </div>
      ))}
    </div>
  ),
};
