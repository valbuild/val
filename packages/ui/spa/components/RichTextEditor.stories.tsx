import type { Meta, StoryObj } from "@storybook/react";
import { RichTextEditor, useRichTextEditor } from "./RichTextEditor";
import { RemirrorJSON } from "@remirror/core";
import { initVal, RichTextSource, AllRichTextOptions } from "@valbuild/core";
import { richTextToRemirror } from "@valbuild/shared/internal";

// Wrapper component that uses the hook
function RichTextEditorStory({
  content,
  options,
}: {
  content?: RichTextSource<AllRichTextOptions>;
  options?: {
    style?: {
      bold?: boolean;
      italic?: boolean;
      lineThrough?: boolean;
    };
    inline?: {
      a?: boolean;
      img?: boolean;
    };
    block?: {
      h1?: boolean;
      h2?: boolean;
      h3?: boolean;
      h4?: boolean;
      h5?: boolean;
      h6?: boolean;
      ul?: boolean;
      ol?: boolean;
    };
  };
}) {
  const initialContent = content ? richTextToRemirror(content) : undefined;
  const { manager, state, setState } = useRichTextEditor(initialContent);

  return (
    <div className="w-full max-w-2xl">
      <RichTextEditor
        manager={manager}
        state={state}
        onChange={(params) => {
          setState(params.state);
        }}
        options={options}
        autoFocus={false}
      />
    </div>
  );
}

const meta: Meta<typeof RichTextEditorStory> = {
  title: "Components/RichTextEditor",
  component: RichTextEditorStory,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="min-h-[300px] w-full p-8 bg-bg-primary text-fg-primary">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof RichTextEditorStory>;

// Empty editor
export const Empty: Story = {
  args: {
    content: [],
    options: {
      style: {
        bold: true,
        italic: true,
        lineThrough: true,
      },
      inline: {
        a: true,
        img: true,
      },
      block: {
        h1: true,
        h2: true,
        h3: true,
        h4: true,
        h5: true,
        h6: true,
        ul: true,
        ol: true,
      },
    },
  },
  name: "Empty",
};

// Editor with a link
export const WithLink: Story = {
  args: {
    content: [
      {
        tag: "p",
        children: [
          "This is a paragraph with a ",
          {
            tag: "a",
            href: "https://val.build",
            children: ["link to Val"],
          },
          " in the middle.",
        ],
      },
    ],
    options: {
      style: {
        bold: true,
        italic: true,
        lineThrough: true,
      },
      inline: {
        a: true,
        img: true,
      },
      block: {
        h1: true,
        h2: true,
        h3: true,
        ul: true,
        ol: true,
      },
    },
  },
  name: "With Link",
};

// Editor with a list
export const WithBulletList: Story = {
  args: {
    content: [
      {
        tag: "p",
        children: ["Here's a bullet list:"],
      },
      {
        tag: "ul",
        children: [
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["First item"],
              },
            ],
          },
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["Second item"],
              },
            ],
          },
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["Third item"],
              },
            ],
          },
        ],
      },
    ],
    options: {
      style: {
        bold: true,
        italic: true,
        lineThrough: true,
      },
      inline: {
        a: true,
        img: true,
      },
      block: {
        h1: true,
        h2: true,
        h3: true,
        ul: true,
        ol: true,
      },
    },
  },
  name: "With Bullet List",
};

// Editor with an ordered list
export const WithOrderedList: Story = {
  args: {
    content: [
      {
        tag: "p",
        children: ["Here's an ordered list:"],
      },
      {
        tag: "ol",
        children: [
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["First step"],
              },
            ],
          },
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["Second step"],
              },
            ],
          },
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["Third step"],
              },
            ],
          },
        ],
      },
    ],
    options: {
      style: {
        bold: true,
        italic: true,
        lineThrough: true,
      },
      inline: {
        a: true,
        img: true,
      },
      block: {
        h1: true,
        h2: true,
        h3: true,
        ul: true,
        ol: true,
      },
    },
  },
  name: "With Ordered List",
};

// Editor with text formatting (bold, italic, strikethrough)
export const WithFormatting: Story = {
  args: {
    content: [
      {
        tag: "p",
        children: [
          "This text is ",
          {
            tag: "span",
            styles: ["bold"],
            children: ["bold"],
          },
          ", this is ",
          {
            tag: "span",
            styles: ["italic"],
            children: ["italic"],
          },
          ", and this is ",
          {
            tag: "span",
            styles: ["line-through"],
            children: ["strikethrough"],
          },
          ".",
        ],
      },
      {
        tag: "p",
        children: [
          "You can also combine them: ",
          {
            tag: "span",
            styles: ["bold", "italic"],
            children: ["bold and italic"],
          },
          ".",
        ],
      },
    ],
    options: {
      style: {
        bold: true,
        italic: true,
        lineThrough: true,
      },
      inline: {
        a: true,
        img: true,
      },
      block: {
        h1: true,
        h2: true,
        h3: true,
        ul: true,
        ol: true,
      },
    },
  },
  name: "With Formatting",
};

// Comprehensive example with multiple features
export const Comprehensive: Story = {
  args: {
    content: [
      {
        tag: "h1",
        children: ["Rich Text Editor Demo"],
      },
      {
        tag: "p",
        children: [
          "This editor supports ",
          {
            tag: "span",
            styles: ["bold"],
            children: ["bold"],
          },
          ", ",
          {
            tag: "span",
            styles: ["italic"],
            children: ["italic"],
          },
          ", and ",
          {
            tag: "span",
            styles: ["line-through"],
            children: ["strikethrough"],
          },
          " text formatting.",
        ],
      },
      {
        tag: "h2",
        children: ["Links"],
      },
      {
        tag: "p",
        children: [
          "You can also add ",
          {
            tag: "a",
            href: "https://val.build",
            children: ["hyperlinks"],
          },
          " to your content.",
        ],
      },
      {
        tag: "h2",
        children: ["Lists"],
      },
      {
        tag: "ul",
        children: [
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["Bullet lists"],
              },
            ],
          },
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["Are"],
              },
            ],
          },
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["Supported"],
              },
            ],
          },
        ],
      },
      {
        tag: "ol",
        children: [
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["As well as"],
              },
            ],
          },
          {
            tag: "li",
            children: [
              {
                tag: "p",
                children: ["Ordered lists"],
              },
            ],
          },
        ],
      },
    ],
    options: {
      style: {
        bold: true,
        italic: true,
        lineThrough: true,
      },
      inline: {
        a: true,
        img: true,
      },
      block: {
        h1: true,
        h2: true,
        h3: true,
        h4: true,
        h5: true,
        h6: true,
        ul: true,
        ol: true,
      },
    },
  },
  name: "Comprehensive Example",
};
