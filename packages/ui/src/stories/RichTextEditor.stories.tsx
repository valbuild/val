import {
  RichTextEditor,
  RichTextEditorProps,
} from "../components/RichTextEditor/RichTextEditor";
import { Meta, Story } from "@storybook/react";
import { AnyRichTextOptions, RichText } from "@valbuild/core";

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
    children: [
      { tag: "h1", children: ["Title 1"] },
      { tag: "h2", children: ["Title 2"] },
      { tag: "h3", children: ["Title 3"] },
      { tag: "h4", children: ["Title 4"] },
      { tag: "h5", children: ["Title 5"] },
      { tag: "h6", children: ["Title 6"] },
      {
        tag: "p",
        children: [
          {
            tag: "span",
            classes: ["bold", "italic", "line-through"],
            children: ["Formatted span"],
          },
        ],
      },
      {
        tag: "ul",
        children: [
          {
            tag: "li",
            children: [
              {
                tag: "ol",
                dir: "rtl",
                children: [
                  {
                    tag: "li",
                    children: [
                      {
                        tag: "span",
                        classes: ["italic"],
                        children: ["number 1.1"],
                      },
                    ],
                  },
                  { tag: "li", children: ["number 1.2"] },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as RichText<AnyRichTextOptions>,
};
