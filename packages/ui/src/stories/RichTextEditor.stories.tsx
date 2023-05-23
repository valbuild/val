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
  entries: [
    {
      source:
        '/app/blogs?en_US?.andThen((v) => v.sortBy((v) => v."rank").map((v, i) => {"title": v."title", "text": v."text"}))."0"."title"',
      status: "ready",
      moduleId: "/app/blogs",
      locale: "en_US",
      value: "Hei på deg din lofotskrei",
      path: "/2/title",
    },
  ],
};
