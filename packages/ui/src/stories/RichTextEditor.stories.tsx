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
    children: [
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: "normal",
            style: "",
            text: "Heading 1",
            type: "text",
            version: 1,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "heading",
        version: 1,
        tag: "h1",
      },
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: "normal",
            style: "",
            text: "Heading 2",
            type: "text",
            version: 1,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "heading",
        version: 1,
        tag: "h2",
      },
      {
        children: [],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: "normal",
            style: "",
            text: "Normal",
            type: "text",
            version: 1,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: "normal",
            style: "font-size: 20px;",
            text: "Normal Font size 20",
            type: "text",
            version: 1,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [
          {
            detail: 0,
            format: 0,
            mode: "normal",
            style: "font-family: serif;",
            text: "Normal font type serif",
            type: "text",
            version: 1,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [
          {
            detail: 0,
            format: 1,
            mode: "normal",
            style: "font-family: serif;",
            text: "Serif and bold",
            type: "text",
            version: 1,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [
          {
            detail: 0,
            format: 2,
            mode: "normal",
            style: "",
            text: "Arial and italic",
            type: "text",
            version: 1,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [],
        direction: null,
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [
          {
            children: [
              {
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: "Num list 1",
                type: "text",
                version: 1,
              },
            ],
            direction: "ltr",
            format: "",
            indent: 0,
            type: "listitem",
            version: 1,
            value: 1,
          },
          {
            children: [
              {
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: "Num list 2",
                type: "text",
                version: 1,
              },
              // TODO: image
              // {
              //   altText: "",
              //   height: 0,
              //   maxWidth: 0,
              //   src: "https://picsum.photos/id/237/200/300",
              //   type: "image",
              //   version: 1,
              //   width: 0,
              // },
            ],
            direction: "ltr",
            format: "",
            indent: 0,
            type: "listitem",
            version: 1,
            value: 2,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "list",
        version: 1,
        listType: "number",
        start: 1,
        tag: "ol",
      },
      {
        children: [],
        direction: null,
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [
          {
            children: [
              {
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: "Bullet list 1",
                type: "text",
                version: 1,
              },
            ],
            direction: "ltr",
            format: "",
            indent: 0,
            type: "listitem",
            version: 1,
            value: 1,
          },
          {
            children: [
              {
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: "Bullet list 2",
                type: "text",
                version: 1,
              },
            ],
            direction: "ltr",
            format: "",
            indent: 0,
            type: "listitem",
            version: 1,
            value: 2,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "list",
        version: 1,
        listType: "bullet",
        start: 1,
        tag: "ul",
      },
      {
        children: [],
        direction: null,
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
      {
        children: [],
        direction: null,
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
    ],
    direction: "ltr",
    format: "",
    indent: 0,
    type: "root",
    version: 1,
  },
};
