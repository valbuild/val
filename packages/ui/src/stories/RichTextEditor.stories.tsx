import {
  RichTextEditor,
  RichTextEditorProps,
} from "../components/RichTextEditor/RichTextEditor";
import { Meta, Story } from "@storybook/react";

export default {
  title: "RichTextEditor",
  component: RichTextEditor,
} as Meta;

const Template: Story<RichTextEditorProps> = (args) => (
  <RichTextEditor {...args} />
);

export const DropdownStory = Template.bind({});

DropdownStory.args = {
  richtext: {
    _type: "richtext",
    templateStrings: ["# Title 1"],
    exprs: [],
  },
};
