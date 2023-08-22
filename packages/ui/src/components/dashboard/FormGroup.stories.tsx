import type { Meta, StoryObj } from "@storybook/react";
import { FormGroup } from "./FormGroup";

const meta: Meta<typeof FormGroup> = { component: FormGroup };

export default meta;
type Story = StoryObj<typeof FormGroup>;

export const Default: Story = {
  render: () => (
    <FormGroup>
        <div>Object 1</div>
        <div>Object 2</div>
        <div>Object 3</div>
        <div>Object 4</div>
    </FormGroup>
  ),
};

export const SeveralGroups: Story = {
    render: () => (
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
    ),
  };