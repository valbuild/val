import type { Meta, StoryObj } from "@storybook/react";
import { ExternalButton } from "../ExternalButton";
import { mockExternal } from "../mockData";

const meta: Meta<typeof ExternalButton> = {
  title: "NavMenuV2/ExternalButton",
  component: ExternalButton,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-80 bg-bg-primary border border-border-primary rounded-lg overflow-hidden">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ExternalButton>;

export const Default: Story = {
  args: {
    external: mockExternal,
    isActive: false,
    onClick: () => console.log("External button clicked"),
  },
};

export const Active: Story = {
  args: {
    external: mockExternal,
    isActive: true,
    onClick: () => console.log("External button clicked"),
  },
};
