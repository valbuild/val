import { Meta, Story } from "@storybook/react";
import Checkbox, { CheckboxProps } from "../components/Checkbox";

export default {
  title: "Checkbox",
  component: Checkbox,
} as Meta;

const Template: Story<CheckboxProps> = (args) => <Checkbox {...args} />;

export const CheckboxStory = Template.bind({});
CheckboxStory.args = {
  label: "Check me",
};
