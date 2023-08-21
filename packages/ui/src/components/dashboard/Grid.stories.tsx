import type { Meta, StoryObj } from "@storybook/react";
import { Grid } from "./Grid";
import { Tree } from "./Tree";
import { Dropdown } from "./Dropdown";

const meta: Meta<typeof Grid> = { component: Grid };

export default meta;
type Story = StoryObj<typeof Grid>;
export const Default: Story = {
  render: () => (
    <Grid>
      <Dropdown>
        <Dropdown.Child>babbabooey</Dropdown.Child>
        <Dropdown.Child>babba</Dropdown.Child>
      </Dropdown>
      <Tree>
        <Tree.Node path="Main nav" type="section" />
        <Tree.Node path="H1" type="text">
          <Tree.Node path="Section 3" type="text" />
          <Tree.Node path="Section 4" type="section">
            <Tree.Node path="Section 5" type="text" />
            <Tree.Node path="Section 6" type="section">
              <Tree.Node path="Section 7" type="text" />
            </Tree.Node>
          </Tree.Node>
        </Tree.Node>
      </Tree>
      <div className="font-serif text-xs w-full h-full flex justify-between items-center px-3 text-white">
        <p>Content</p>
        <button className="flex justify-between gap-1">
          <span className="w-fit">+</span>
          <span className="w-fit">Add item</span>
        </button>
      </div>
      <div className="flex flex-col text-white all-but-last-child:border-dark-gray">
        test 2
      </div>
      <div className="text-white">History</div>
      <div className="text-white">hey</div>
    </Grid>
  ),
};
