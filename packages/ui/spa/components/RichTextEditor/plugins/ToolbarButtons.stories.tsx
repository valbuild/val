import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useEffect, useState, useMemo } from "react";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history } from "prosemirror-history";
import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { ToolbarButtons } from "./ToolbarButtonsComponent";
import { buildSchema } from "../schema";
import { createLinkHelper, type LinkHelper } from "./formattingToolbarShared";
import type {
  EditorFeatures,
  EditorButtonVariant,
  EditorDetailsVariant,
  EditorLinkCatalogItem,
  EditorStyleConfig,
  ResolvedEditorFeatures,
} from "../types";
import { DEFAULT_FEATURES } from "../types";

interface ToolbarDemoProps {
  featureOverrides?: Partial<EditorFeatures>;
  buttonVariants?: EditorButtonVariant[];
  detailsVariants?: EditorDetailsVariant[];
  linkCatalog?: EditorLinkCatalogItem[];
  styleConfig?: EditorStyleConfig;
  showBlockTypeSelect?: boolean;
  floatingStyle?: boolean;
}

function ToolbarDemo({
  featureOverrides,
  buttonVariants,
  detailsVariants,
  linkCatalog,
  styleConfig,
  showBlockTypeSelect = true,
  floatingStyle = false,
}: ToolbarDemoProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const linkHelperRef = useRef<LinkHelper | null>(null);
  const [, forceRender] = useState(0);

  const features: Partial<EditorFeatures> = useMemo(
    () => ({ ...featureOverrides, styles: styleConfig }),
    [featureOverrides, styleConfig],
  );

  const schema = useMemo(
    () =>
      buildSchema({
        features,
        buttonVariants,
        detailsVariants,
        styleConfig,
      }),
    [features, buttonVariants, detailsVariants, styleConfig],
  );

  const resolvedFeatures: ResolvedEditorFeatures = useMemo(() => {
    const f = features;
    return {
      bold: f.bold ?? DEFAULT_FEATURES.bold,
      italic: f.italic ?? DEFAULT_FEATURES.italic,
      strikethrough: f.strikethrough ?? DEFAULT_FEATURES.strikethrough,
      code: f.code ?? DEFAULT_FEATURES.code,
      link: f.link ?? DEFAULT_FEATURES.link,
      image: f.image ?? DEFAULT_FEATURES.image,
      h1: f.h1 ?? DEFAULT_FEATURES.h1,
      h2: f.h2 ?? DEFAULT_FEATURES.h2,
      h3: f.h3 ?? DEFAULT_FEATURES.h3,
      h4: f.h4 ?? DEFAULT_FEATURES.h4,
      h5: f.h5 ?? DEFAULT_FEATURES.h5,
      h6: f.h6 ?? DEFAULT_FEATURES.h6,
      bulletList: f.bulletList ?? DEFAULT_FEATURES.bulletList,
      orderedList: f.orderedList ?? DEFAULT_FEATURES.orderedList,
      blockquote: f.blockquote ?? DEFAULT_FEATURES.blockquote,
      details: f.details ?? DEFAULT_FEATURES.details,
      codeBlock: f.codeBlock ?? DEFAULT_FEATURES.codeBlock,
      hardBreak: f.hardBreak ?? DEFAULT_FEATURES.hardBreak,
      button: f.button ?? DEFAULT_FEATURES.button,
      fixedToolbar: f.fixedToolbar ?? DEFAULT_FEATURES.fixedToolbar,
      floatingToolbar: f.floatingToolbar ?? DEFAULT_FEATURES.floatingToolbar,
      gutter: f.gutter ?? DEFAULT_FEATURES.gutter,
      styles: styleConfig,
    };
  }, [features, styleConfig]);

  useEffect(() => {
    if (!editorContainerRef.current) return;

    const lh = createLinkHelper({
      getLinkCatalog: () => linkCatalog,
      onPickerStateChange: () => {},
      isPickerOpen: () => false,
    });
    linkHelperRef.current = lh;

    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("Select this text to test toolbar buttons."),
      ]),
      schema.node("paragraph", null, [
        schema.text("Another paragraph for block type testing."),
      ]),
    ]);

    const state = EditorState.create({
      doc,
      plugins: [keymap(baseKeymap), history()],
    });

    const view = new EditorView(editorContainerRef.current, {
      state,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr);
        view.updateState(newState);
        forceRender((c) => c + 1);
      },
    });

    viewRef.current = view;
    forceRender((c) => c + 1);

    return () => {
      view.destroy();
      viewRef.current = null;
      lh.destroy();
      linkHelperRef.current = null;
    };
  }, [schema, linkCatalog]);

  const view = viewRef.current;
  const linkHelper = linkHelperRef.current;

  const toolbarClasses = floatingStyle
    ? "inline-flex items-center gap-0.5 rounded-lg border border-border-primary bg-bg-primary px-1.5 py-1 shadow-xl"
    : "flex items-center gap-0.5 rounded-t-md border border-border-primary bg-bg-secondary px-1.5 py-1";

  return (
    <div className="flex flex-col gap-3">
      <div className={toolbarClasses}>
        {view && linkHelper && (
          <ToolbarButtons
            view={view}
            schema={schema}
            features={resolvedFeatures}
            linkHelper={linkHelper}
            options={{ showBlockTypeSelect }}
            buttonVariants={buttonVariants}
            detailsVariants={detailsVariants}
            linkCatalog={linkCatalog}
            styleConfig={styleConfig}
          />
        )}
      </div>
      <div
        ref={editorContainerRef}
        className="prose-editor min-h-[120px] rounded-md border border-border-primary bg-bg-primary p-3 text-fg-primary caret-fg-primary focus-within:ring-2 focus-within:ring-border-brand-primary"
      />
    </div>
  );
}

const meta: Meta = {
  title: "RichTextEditor/ToolbarButtons",
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl p-4">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj;

export const AllFeatures: Story = {
  render: () => <ToolbarDemo />,
};

export const MarksOnly: Story = {
  render: () => (
    <ToolbarDemo
      featureOverrides={{
        bold: true,
        italic: true,
        strikethrough: true,
        code: true,
        link: true,
        h1: false,
        h2: false,
        h3: false,
        h4: false,
        h5: false,
        h6: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
      }}
      showBlockTypeSelect={false}
    />
  ),
};

export const ListsOnly: Story = {
  render: () => (
    <ToolbarDemo
      featureOverrides={{
        bold: false,
        italic: false,
        strikethrough: false,
        code: false,
        link: false,
        h1: false,
        h2: false,
        h3: false,
        h4: false,
        h5: false,
        h6: false,
        bulletList: true,
        orderedList: true,
        blockquote: false,
        codeBlock: false,
      }}
      showBlockTypeSelect={false}
    />
  ),
};

export const WithBlockTypeSelect: Story = {
  render: () => <ToolbarDemo showBlockTypeSelect />,
};

export const WithButtonDropdown: Story = {
  render: () => (
    <ToolbarDemo
      featureOverrides={{ button: true }}
      buttonVariants={[
        { variant: "cta-button", label: "CTA Button", children: false },
        {
          variant: "generic-button",
          label: "Generic Button",
          children: "string",
        },
        {
          variant: "link-button",
          label: "Link Button",
          children: "string",
          link: true,
        },
      ]}
    />
  ),
};

export const WithDetailsDropdown: Story = {
  render: () => (
    <ToolbarDemo
      featureOverrides={{ details: true }}
      detailsVariants={[
        { variant: "details", label: "Details" },
        { variant: "footnote", label: "Footnote" },
        { variant: "explanation", label: "Explanation" },
      ]}
    />
  ),
};

export const WithCustomStyles: Story = {
  render: () => (
    <ToolbarDemo
      styleConfig={{
        highlight: { label: "Highlight", css: { backgroundColor: "#fef08a" } },
        danger: {
          label: "Danger",
          css: { color: "#dc2626", fontWeight: "bold" },
        },
      }}
    />
  ),
};

export const WithLinkCatalog: Story = {
  render: () => (
    <ToolbarDemo
      linkCatalog={[
        { title: "Home", subtitle: "/", href: "/" },
        { title: "About", subtitle: "/about", href: "/about" },
        { title: "Blog", subtitle: "/blog", href: "/blog" },
      ]}
    />
  ),
};

export const FloatingStyle: Story = {
  render: () => <ToolbarDemo floatingStyle />,
};

export const KitchenSink: Story = {
  render: () => (
    <ToolbarDemo
      featureOverrides={{ button: true, details: true }}
      buttonVariants={[
        { variant: "cta-button", label: "CTA", children: false },
        {
          variant: "nav-button",
          label: "Nav",
          children: "string",
          link: [
            { title: "Home", subtitle: "/", href: "/" },
            { title: "About", subtitle: "/about", href: "/about" },
          ],
        },
      ]}
      detailsVariants={[
        { variant: "details", label: "Details" },
        { variant: "footnote", label: "Footnote" },
      ]}
      styleConfig={{
        highlight: { label: "Highlight", css: { backgroundColor: "#fef08a" } },
      }}
      linkCatalog={[
        { title: "Docs", subtitle: "/docs", href: "/docs" },
        { title: "API", subtitle: "/api", href: "/api" },
      ]}
    />
  ),
};
