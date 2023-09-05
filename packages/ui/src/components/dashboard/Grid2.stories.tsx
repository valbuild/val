import type { Meta, StoryObj } from "@storybook/react";
import { Grid } from "./Grid2";
import { Tree } from "./Tree";
import { Dropdown } from "./Dropdown";
import { FormGroup } from "./FormGroup";

const meta: Meta<typeof Grid> = { component: Grid };

export default meta;
type Story = StoryObj<typeof Grid>;
export const Default: Story = {
  render: () => (
    <Grid>
      <Grid.Row>
        <Dropdown options={["/blogs", "/journals"]} />
        <div className="font-serif text-xs w-full h-full flex justify-between items-center px-3 text-white">
          <p>Content</p>
          <button className="flex justify-between gap-1 flex-shrink-0">
            <span className="w-fit">+</span>
            <span className="w-fit">Add item</span>
          </button>
        </div>
        <div className="text-white">History</div>
      </Grid.Row>
      <Grid.Row fill>
        <Tree>
          <Tree.Node path="Main nav" type="section" />
          <Tree.Node path="H1" type="string">
            <Tree.Node path="Section 3" type="string" />
            <Tree.Node path="Section 4" type="section">
              <Tree.Node path="Section 5" type="string" />
              <Tree.Node path="Section 6" type="section">
                <Tree.Node path="Section 7" type="string" />
              </Tree.Node>
            </Tree.Node>
          </Tree.Node>
        </Tree>
        <div>
          <FormGroup>
            <div>Object 1</div>
            <div>Object 2</div>
            <div>Object 3</div>
            <div>Object 4</div>
          </FormGroup>
          <FormGroup>
            <div>Object 5</div>
            <div>Object 6</div>
            <div>Object 7</div>
            <div>Object 8</div>
          </FormGroup>
        </div>
        <div className="text-white">hey</div>
      </Grid.Row>
    </Grid>
  ),
};
