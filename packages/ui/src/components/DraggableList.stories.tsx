import type { Meta, StoryObj } from "@storybook/react";

import { DraggableList } from "./DraggableList";

const meta: Meta<typeof DraggableList> = { component: DraggableList };

export default meta;
type Story = StoryObj<typeof DraggableList>;

export const Default: Story = {
  args: {
    children: [
      <div className="val-p-4 val-bg-white val-w-fit">test 1</div>,
      <div className="val-p-4 val-bg-white val-w-fit">test 2</div>,
      <div className="val-p-4 val-bg-white val-w-fit">test 3</div>,
      <div className="val-p-4 val-bg-white val-w-fit">test 4</div>,
      <div className="val-p-4 val-bg-white val-w-fit">test 5</div>,
    ],
  },
};
