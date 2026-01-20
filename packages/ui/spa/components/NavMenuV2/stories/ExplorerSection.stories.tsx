import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ExplorerSection } from "../ExplorerSection";
import { mockExplorer } from "../mockData";
import { Accordion } from "../../designSystem/accordion";

const meta: Meta<typeof ExplorerSection> = {
  title: "NavMenuV2/ExplorerSection",
  component: ExplorerSection,
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
type Story = StoryObj<typeof ExplorerSection>;

// Interactive wrapper to handle state with Accordion
function InteractiveExplorerSection({
  defaultExpanded = true,
  ...props
}: React.ComponentProps<typeof ExplorerSection> & {
  defaultExpanded?: boolean;
}) {
  const [value, setValue] = useState(defaultExpanded ? "explorer" : "");
  return (
    <Accordion type="single" collapsible value={value} onValueChange={setValue}>
      <ExplorerSection {...props} />
    </Accordion>
  );
}

export const Default: Story = {
  render: () => (
    <InteractiveExplorerSection
      explorer={mockExplorer}
      onNavigate={(path) => console.log("Navigate to:", path)}
    />
  ),
};

export const Collapsed: Story = {
  render: () => (
    <InteractiveExplorerSection
      explorer={mockExplorer}
      defaultExpanded={false}
      onNavigate={(path) => console.log("Navigate to:", path)}
    />
  ),
};

export const WithActivePath: Story = {
  render: () => (
    <InteractiveExplorerSection
      explorer={mockExplorer}
      currentPath="/content/authors.val.ts"
      onNavigate={(path) => console.log("Navigate to:", path)}
    />
  ),
};

export const WithErrors: Story = {
  render: () => (
    <InteractiveExplorerSection
      explorer={mockExplorer}
      onNavigate={(path) => console.log("Navigate to:", path)}
    />
  ),
  name: "With Validation Errors",
};
