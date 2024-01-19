import type { Meta, StoryObj } from "@storybook/react";

import { RichTextEditor, useRichTextEditor } from "./RichTextEditor";
import { ValUIContext } from "./ValUIContext";
import {
  AnyRichTextOptions,
  FILE_REF_PROP,
  RichTextOptions,
  RichTextSource,
  initVal,
} from "@valbuild/core";
import { useState, useLayoutEffect, useRef, CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  parseRichTextSource,
  remirrorToRichTextSource,
  richTextToRemirror,
} from "@valbuild/shared/internal";
import { RemirrorJSON as ValidRemirrorJSON } from "@valbuild/shared/internal";

const DEBUG = true;
const { c } = initVal();

type StoryType = {
  defaultValue: RichTextSource<AnyRichTextOptions>;
  options?: RichTextOptions;
};
const meta: Meta<StoryType> = {
  title: "components/RichTextEditor",
  render: (props: StoryType) => {
    const { state, manager } = useRichTextEditor(
      richTextToRemirror(parseRichTextSource(props.defaultValue))
    );

    return (
      <ValUIContext.Provider
        value={{
          theme: "dark",
          setTheme: () => {},
          editMode: "hover",
          setEditMode: () => {},
          session: {
            status: "success",
            data: { enabled: true, mode: "local" },
          },
          setWindowSize: () => {},
        }}
      >
        <div className="text-primary bg-background">
          <RichTextEditor
            manager={manager}
            state={state}
            options={props.options}
            debug={DEBUG}
            onChange={(doc) => {
              const parseRes = ValidRemirrorJSON.safeParse(doc);
              if (!parseRes.success) {
                console.error("Failed to parse", parseRes.error);
              }
              if (DEBUG) {
                console.debug("state", doc);
                if (parseRes.success) {
                  const a = remirrorToRichTextSource(parseRes.data);
                  console.debug(stringifyRichTextSource(a));
                  console.debug("files", a.files);
                }
              }
            }}
          />
        </div>
      </ValUIContext.Provider>
    );
  },
};

export default meta;
type Story = StoryObj<StoryType>;

export const Default: Story = {
  args: {
    defaultValue: c.richtext`Testing 1-2-3
    
New line!`,
  },
};

export const Basics: Story = {
  args: {
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
    defaultValue: c.richtext`
# Title 1

## Title 2

- Bullet item 1
- Bullet item 2

1. List item 1
1. List item 2

${c.rt.link("Link to ValBuild", { href: "https://val.build" })}
`,
  },
};

// Test that RichTextEditor works with ShadowRoot
function ShadowContent({
  root,
  children,
}: {
  children: React.ReactNode;
  root: Element | DocumentFragment;
}) {
  return createPortal(children, root);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ShadowRoot = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: CSSProperties;
}) => {
  const node = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);

  useLayoutEffect(() => {
    if (node.current) {
      if (node.current.shadowRoot) {
        setRoot(node.current.shadowRoot);
      } else {
        const root = node.current.attachShadow({
          mode: "open",
        });
        setRoot(root);
      }
    }
  }, []);

  return (
    <div ref={node} style={style} id="val-ui">
      {root && <ShadowContent root={root}>{children}</ShadowContent>}
    </div>
  );
};

// For debug purposes

function stringifyRichTextSource({
  templateStrings,
  exprs,
}: RichTextSource<AnyRichTextOptions>): string {
  let lines = "";
  for (let i = 0; i < templateStrings.length; i++) {
    const line = templateStrings[i];
    const expr = exprs[i];
    lines += line;
    if (expr) {
      if (expr._type === "file") {
        lines += `\${c.rt.image("${expr[FILE_REF_PROP]}", ${JSON.stringify(
          expr.metadata
        )})}`;
      } else if (expr._type === "link") {
        lines += `\${c.rt.link("${expr.children[0]}", ${JSON.stringify({
          href: expr.href,
        })})}`;
      } else {
        throw Error("Unknown expr: " + JSON.stringify(expr, null, 2));
      }
    }
  }
  return lines;
}
