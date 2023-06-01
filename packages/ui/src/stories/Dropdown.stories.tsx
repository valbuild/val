import { Meta, Story } from "@storybook/react";
import Italic from "../assets/icons/Italic";
import Dropdown, { DropdownProps } from "../components/Dropdown";

export default {
  title: "Dropdown",
  component: Dropdown,
} as Meta;

const Template: Story<DropdownProps> = (args) => <Dropdown {...args} />;

export const DropdownStory = Template.bind({});
DropdownStory.args = {
  label: "Font",
  options: ["Arial", "Times New Roman", "Courier New"],
};

export const DropdownWithIcon = Template.bind({});
DropdownWithIcon.args = {
  label: "Font",
  options: ["Arial", "Times New Roman", "Courier New"],
  icon: <Italic />,
};
