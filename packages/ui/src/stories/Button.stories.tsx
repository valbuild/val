import { Meta, Story } from "@storybook/react";
import Underline from "../assets/icons/Underline";
import Button, { ButtonProps } from "../components/Button";

export default {
  title: "Button",
  component: Button,
} as Meta;

const Template: Story<ButtonProps> = (args) => <Button {...args} />;

export const ButtonStory = Template.bind({});
ButtonStory.args = {
  children: <div>Button</div>,
};

export const ButtonWithIcon = Template.bind({});
ButtonWithIcon.args = {
  icon: <Underline />,
};
