import type { Meta, StoryObj } from "@storybook/react";

import { RichTextEditor } from "./RichTextEditor";
import { ValUIContext } from "./ValUIContext";
import { ComponentProps } from "react";
import { AnyRichTextOptions, initVal } from "@valbuild/core";
const { val } = initVal();

const meta: Meta<typeof RichTextEditor> = {
  component: RichTextEditor,
  render: (props: ComponentProps<typeof RichTextEditor>) => (
    <ValUIContext.Provider
      value={{
        theme: "light",
        setTheme: () => {},
        editMode: "full",
        setEditMode: () => {},
        session: {
          status: "success",
          data: { enabled: true, mode: "local" },
        },
        setWindowSize: () => {},
      }}
    >
      <div className="text-primary bg-background">
        <RichTextEditor {...props} />
      </div>
    </ValUIContext.Provider>
  ),
};

export default meta;
type Story = StoryObj<typeof RichTextEditor>;

export const Default: Story = {
  args: {
    defaultValue: val.richtext`Testing 1-2-3
    
New line!`,
  },
};

export const All: Story = {
  args: {
    debug: true,
    options: {
      headings: ["h1", "h2", "h3", "h4", "h5", "h6"],
      bold: true,
      italic: true,
      lineThrough: true,
      a: true,
      img: true,
      ul: true,
      ol: true,
    } satisfies AnyRichTextOptions,
    defaultValue: val.richtext`
# Title 1

# Title 2

- Bullet item 1
- Bullet item 2

1. List item 1
2. List item 2

${val.link("Link to ValBuild", { href: "https://valbuild.com" })}<br />
<br />
<br />

${val.file("/public/valbuild.png", {
  width: 100,
  height: 100,
  mimeType: "image/png",
  sha256: "1234567890",
})}
`,
  },
};

export const WIP: Story = {
  args: {
    debug: true,
    options: {
      headings: ["h1", "h2", "h3", "h4", "h5", "h6"],
      bold: true,
      italic: true,
      lineThrough: true,
      a: true,
      img: true,
      ul: true,
      ol: true,
    } satisfies AnyRichTextOptions,
    defaultValue: val.richtext`
# Title 1

# Title 2

- Bullet item 1
- Bullet item 2

1. List item 1
2. List item 2

${val.link("Link to ValBuild", { href: "https://valbuild.com" })}

${val.file("/public/valbuild.png", {
  width: 100,
  height: 100,
  mimeType: "image/png",
  sha256: "1234567890",
})}
`,
  },
};
