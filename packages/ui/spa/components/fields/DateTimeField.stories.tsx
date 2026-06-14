import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { DateTimeFieldPure } from "./DateTimeField";

const meta: Meta<typeof DateTimeFieldPure> = {
  title: "Fields/DateTimeField",
  component: DateTimeFieldPure,
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
type Story = StoryObj<typeof DateTimeFieldPure>;

function Wrapper(props: {
  initial?: Date | null;
  from?: string;
  to?: string;
  defaultTimezone?: string;
  availableTimezones?: string[];
}) {
  const [value, setValue] = useState<Date | null>(props.initial ?? null);
  return (
    <div className="flex flex-col gap-2">
      <DateTimeFieldPure
        value={value}
        onChange={(iso) => setValue(new Date(iso))}
        from={props.from}
        to={props.to}
        defaultTimezone={props.defaultTimezone}
        availableTimezones={props.availableTimezones}
      />
      <code className="text-xs text-fg-tertiary">
        {value ? value.toISOString() : "<empty>"}
      </code>
    </div>
  );
}

export const Empty: Story = {
  name: "Empty (no value)",
  render: () => <Wrapper initial={null} />,
};

export const WithValue: Story = {
  name: "With initial value",
  render: () => <Wrapper initial={new Date("2025-06-15T14:30:00Z")} />,
};

export const Bounded: Story = {
  name: "With from/to bounds",
  render: () => (
    <Wrapper
      initial={new Date("2025-06-15T14:30:00Z")}
      from="2025-01-01T00:00:00Z"
      to="2025-12-31T23:59:59Z"
    />
  ),
};

export const OutOfBoundsDefault: Story = {
  name: "Above upper bound (date picker should clamp)",
  render: () => (
    <Wrapper
      initial={new Date("2030-06-15T14:30:00Z")}
      from="2020-01-01T00:00:00Z"
      to="2024-12-31T23:59:59Z"
    />
  ),
};

export const FixedTimezoneList: Story = {
  name: "Curated timezone list",
  render: () => (
    <Wrapper
      initial={new Date("2025-06-15T14:30:00Z")}
      availableTimezones={[
        "UTC",
        "Europe/Oslo",
        "Europe/London",
        "America/New_York",
        "Asia/Tokyo",
      ]}
    />
  ),
};

export const ForcedUtc: Story = {
  name: "Forced UTC default",
  render: () => (
    <Wrapper initial={new Date("2025-06-15T14:30:00Z")} defaultTimezone="UTC" />
  ),
};
