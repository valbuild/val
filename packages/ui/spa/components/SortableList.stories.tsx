import type { Meta, StoryObj } from "@storybook/react";

import { SortableList } from "./SortableList";
import { SourcePath } from "@valbuild/core";

const meta: Meta<typeof SortableList> = { component: SortableList };

export default meta;
type Story = StoryObj<typeof SortableList>;

export const Default: Story = {
  render: (args) => (
    <div className="max-w-[800px]">
      <SortableList {...args} />
    </div>
  ),
  args: {
    source: [
      {
        name: "Item 1",
        fields: ["Field 1", "Field 2", "Field 3"],
      },
      {
        name: "Item 2",
      },
      {
        name: "Item 3",
      },
    ],
    path: "/content/items" as SourcePath,
    schema: {
      type: "array",
      opt: false,
      item: {
        type: "record",
        opt: false,
        item: {
          type: "string",
          opt: false,
          raw: false,
        },
      },
    },
  },
};
