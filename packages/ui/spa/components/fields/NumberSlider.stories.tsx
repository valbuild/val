import type { Meta, StoryObj } from "@storybook/react";
import { NumberRules, SliderRender } from "@valbuild/core";
import { useState } from "react";
import { NumberSliderPure } from "./NumberSlider";

const meta: Meta<typeof NumberSliderPure> = {
  title: "Fields/NumberSlider",
  component: NumberSliderPure,
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
type Story = StoryObj<typeof NumberSliderPure>;

function Wrapper(props: {
  initial: number | null;
  render: SliderRender;
  rules?: NumberRules;
  readonly?: boolean;
}) {
  const [value, setValue] = useState<number | null>(props.initial);
  return (
    <div className="flex flex-col gap-2 w-[420px]">
      <NumberSliderPure
        value={value}
        onChange={setValue}
        render={props.render}
        rules={props.rules ?? { integer: true }}
        readonly={props.readonly}
      />
      <code className="text-xs text-fg-tertiary">{String(value)}</code>
    </div>
  );
}

export const Percentage: Story = {
  name: "0–100 in steps of 5",
  render: () => (
    <Wrapper
      initial={40}
      render={{ as: "slider", min: 0, max: 100, step: 5 }}
    />
  ),
};

export const FewStops: Story = {
  name: "1–5 (every stop labelled)",
  render: () => (
    <Wrapper
      initial={4}
      render={{ as: "slider", min: 1, max: 5 }}
      rules={{ integer: true, min: 1, max: 5 }}
    />
  ),
};

export const OutOfRange: Story = {
  name: "Value above the slider's range",
  render: () => (
    <Wrapper initial={150} render={{ as: "slider", min: 0, max: 100 }} />
  ),
};

export const OffStep: Story = {
  name: "Value between the schema's steps",
  render: () => (
    <Wrapper
      initial={42}
      render={{ as: "slider", min: 0, max: 100 }}
      rules={{ integer: true, min: 0, step: 5 }}
    />
  ),
};

export const Decimal: Story = {
  name: "s.number() from 0 to 1 in tenths",
  render: () => (
    <Wrapper
      initial={0.3}
      render={{ as: "slider", min: 0, max: 1, step: 0.1 }}
      rules={{}}
    />
  ),
};

export const Empty: Story = {
  name: "Nullable, no value yet",
  render: () => (
    <Wrapper initial={null} render={{ as: "slider", min: 0, max: 10 }} />
  ),
};

export const Readonly: Story = {
  render: () => (
    <Wrapper initial={7} render={{ as: "slider", min: 0, max: 10 }} readonly />
  ),
};
