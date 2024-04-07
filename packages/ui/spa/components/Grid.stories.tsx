import type { Meta, StoryObj } from "@storybook/react";
import { Grid } from "./Grid";
const meta: Meta<typeof Grid> = { component: Grid };

export default meta;
type Story = StoryObj<typeof Grid>;
export const Default: Story = {
  render: () => (
    <Grid>
      <div className="flex items-center justify-between w-full h-full px-3 font-serif text-xs text-white">
        <p>Content</p>
        <button className="flex justify-between flex-shrink-0 gap-1">
          <span className="w-fit">+</span>
          <span className="w-fit">Add item</span>
        </button>
      </div>
      <div>
        <div>Object 1</div>
        <div>Object 2</div>
        <div>Object 3</div>
        <div>Object 4</div>
      </div>
      <div className="text-white">History</div>
      <div className="text-white">hey</div>
    </Grid>
  ),
};
