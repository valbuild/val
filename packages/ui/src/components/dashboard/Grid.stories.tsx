import type { Meta, StoryObj } from "@storybook/react";
import { Grid } from "./Grid";
import { Tree } from "./Tree";
import { Dropdown } from "./Dropdown";
import { FormGroup } from "./FormGroup";

const meta: Meta<typeof Grid> = { component: Grid };

export default meta;
type Story = StoryObj<typeof Grid>;
export const Default: Story = {
  render: () => (
    <Grid>
      <Dropdown options={["/blogs", "/journals"]} />
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
      <div className="val-font-serif val-text-xs val-w-full val-h-full val-flex val-justify-between val-items-center val-px-3 val-text-white">
        <p>Content</p>
        <button className="val-flex val-justify-between val-gap-1 val-flex-shrink-0">
          <span className="val-w-fit">+</span>
          <span className="val-w-fit">Add item</span>
        </button>
      </div>
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
      <div className="val-text-white">History</div>
      <div className="val-text-white">hey</div>
    </Grid>
  ),
};
