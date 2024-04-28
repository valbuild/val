import type { Meta, StoryObj } from "@storybook/react";

import { SortableList } from "./SortableList";

const meta: Meta<typeof SortableList> = { component: SortableList };

export default meta;
type Story = StoryObj<typeof SortableList>;

export const Default: Story = {
  args: {
    children: [
      <div className="p-4 bg-white w-fit">test 1</div>,
      <div className="p-4 bg-white w-fit">test 2</div>,
      <div className="p-4 bg-white w-fit">test 3</div>,
      <div className="p-4 bg-white w-fit">test 4</div>,
      <div className="p-4 bg-white w-fit">test 5</div>,
    ],
  },
};
