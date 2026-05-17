import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useState, useCallback } from "react";
import { RichTextEditor } from "./RichTextEditor";
import type {
  EditorDocument,
  EditorError,
  EditorChangePayload,
  EditorLinkCatalogItem,
  EditorImage,
  EditorButtonVariant,
  EditorDetailsVariant,
  EditorStyleConfig,
  RichTextEditorRef,
} from "./types";

const SAMPLE_IMAGES: EditorImage[] = [
  { url: "https://placehold.co/600x400/e2e8f0/475569?text=Mountains" },
  { url: "https://placehold.co/600x400/fce7f3/9d174d?text=Sunset" },
  { url: "https://placehold.co/600x400/d1fae5/065f46?text=Forest" },
  { url: "https://placehold.co/600x400/dbeafe/1e40af?text=Ocean" },
  { url: "https://placehold.co/600x400/fef3c7/92400e?text=Desert" },
];

const meta: Meta<typeof RichTextEditor> = {
  title: "RichTextEditor",
  component: RichTextEditor,
  args: {
    images: SAMPLE_IMAGES,
  },
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl p-4">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof RichTextEditor>;

const sampleDoc: EditorDocument = [
  { tag: "h1", children: ["Welcome to the Editor"] },
  {
    tag: "p",
    children: [
      "This is a ",
      { tag: "span", styles: ["bold"], children: ["rich text"] },
      " editor with ",
      { tag: "span", styles: ["italic"], children: ["various"] },
      " formatting options.",
    ],
  },
  {
    tag: "p",
    children: [
      "It supports ",
      { tag: "a", href: "https://example.com", children: ["links"] },
      " and ",
      { tag: "span", styles: ["line-through"], children: ["strikethrough"] },
      " text.",
    ],
  },
];

const fullFeaturedDoc: EditorDocument = [
  { tag: "h1", children: ["Heading 1"] },
  { tag: "h2", children: ["Heading 2"] },
  { tag: "h3", children: ["Heading 3"] },
  {
    tag: "p",
    children: [
      { tag: "span", styles: ["bold"], children: ["Bold"] },
      " ",
      { tag: "span", styles: ["italic"], children: ["Italic"] },
      " ",
      { tag: "span", styles: ["line-through"], children: ["Strikethrough"] },
      " ",
      { tag: "span", styles: ["code"], children: ["inline code"] },
    ],
  },
  {
    tag: "p",
    children: [{ tag: "a", href: "https://example.com", children: ["A link"] }],
  },
  {
    tag: "ul",
    children: [
      { tag: "li", children: [{ tag: "p", children: ["Bullet item 1"] }] },
      { tag: "li", children: [{ tag: "p", children: ["Bullet item 2"] }] },
    ],
  },
  {
    tag: "ol",
    children: [
      { tag: "li", children: [{ tag: "p", children: ["Numbered item 1"] }] },
      { tag: "li", children: [{ tag: "p", children: ["Numbered item 2"] }] },
    ],
  },
  {
    tag: "blockquote",
    children: [{ tag: "p", children: ["A blockquote"] }],
  },
  { tag: "pre", children: ["const x = 1;\nconsole.log(x);"] },
  {
    tag: "p",
    children: [
      "Inline image: ",
      { tag: "img", src: "https://placehold.co/100x30?text=Inline" },
    ],
  },
];

// 1. Default editor
export const Default: Story = {};

// 2. Feature matrix
export const FeatureMatrix: Story = {
  args: {
    defaultValue: fullFeaturedDoc,
  },
};

export const BoldItalicStrikethrough: Story = {
  args: {
    features: {
      bold: true,
      italic: true,
      strikethrough: true,
      code: false,
      link: false,
      image: false,

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
    },
    defaultValue: [
      {
        tag: "p",
        children: [
          { tag: "span", styles: ["bold"], children: ["Bold"] },
          " ",
          { tag: "span", styles: ["italic"], children: ["Italic"] },
          " ",
          {
            tag: "span",
            styles: ["line-through"],
            children: ["Strikethrough"],
          },
        ],
      },
    ],
  },
};

export const HeadingsOnly: Story = {
  args: {
    features: {
      bold: false,
      italic: false,
      strikethrough: false,
      link: false,
      h1: true,
      h2: true,
      h3: true,
    },
    defaultValue: [
      { tag: "h1", children: ["Heading 1"] },
      { tag: "h2", children: ["Heading 2"] },
      { tag: "h3", children: ["Heading 3"] },
      { tag: "p", children: ["Regular text"] },
    ],
  },
};

export const ListsOnly: Story = {
  args: {
    features: {
      bold: false,
      italic: false,
      h1: false,
      h2: false,
      h3: false,
      h4: false,
      h5: false,
      h6: false,
      bulletList: true,
      orderedList: true,
    },
    defaultValue: [
      {
        tag: "ul",
        children: [
          { tag: "li", children: [{ tag: "p", children: ["Bullet 1"] }] },
          { tag: "li", children: [{ tag: "p", children: ["Bullet 2"] }] },
        ],
      },
      {
        tag: "ol",
        children: [
          { tag: "li", children: [{ tag: "p", children: ["Number 1"] }] },
          { tag: "li", children: [{ tag: "p", children: ["Number 2"] }] },
        ],
      },
    ],
  },
};

export const CodeAndBlockquote: Story = {
  args: {
    features: {
      code: true,
      codeBlock: true,
      blockquote: true,
    },
    defaultValue: [
      {
        tag: "p",
        children: [
          "Use ",
          { tag: "span", styles: ["code"], children: ["inline code"] },
          " for short snippets.",
        ],
      },
      { tag: "pre", children: ["function hello() {\n  return 'world';\n}"] },
      {
        tag: "blockquote",
        children: [{ tag: "p", children: ["This is a quote."] }],
      },
    ],
  },
};

export const LinksAndImages: Story = {
  args: {
    features: {
      link: true,
      image: true,
    },
    defaultValue: [
      {
        tag: "p",
        children: [
          { tag: "a", href: "https://example.com", children: ["A link"] },
          " and inline image: ",
          { tag: "img", src: "https://placehold.co/100x30?text=Inline" },
        ],
      },
    ],
  },
};

// 3. Controlled
function ControlledStory() {
  const [value, setValue] = useState<EditorDocument>(sampleDoc);
  const [patches, setPatches] = useState<string>("");

  const handleChange = useCallback((payload: EditorChangePayload) => {
    setValue(payload.value);
    setPatches(JSON.stringify(payload.patches, null, 2));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <RichTextEditor
        value={value}
        onChange={handleChange}
        images={SAMPLE_IMAGES}
      />
      <div className="rounded border border-border-secondary bg-bg-secondary p-3">
        <h3 className="mb-2 text-sm font-bold text-fg-secondary">
          Patches (RFC 6902)
        </h3>
        <pre className="max-h-48 overflow-auto text-xs text-fg-secondary-alt">
          {patches || "(no changes yet)"}
        </pre>
      </div>
      <div className="rounded border border-border-secondary bg-bg-secondary p-3">
        <h3 className="mb-2 text-sm font-bold text-fg-secondary">
          Current Value
        </h3>
        <pre className="max-h-48 overflow-auto text-xs text-fg-secondary-alt">
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    </div>
  );
}

export const Controlled: Story = {
  render: () => <ControlledStory />,
};

// 4. Uncontrolled + programmatic reset + getPatches
function UncontrolledResetStory() {
  const editorRef = useRef<RichTextEditorRef>(null);
  const [output, setOutput] = useState<string>("");
  const [patchOutput, setPatchOutput] = useState<string>("");

  return (
    <div className="flex flex-col gap-4">
      <RichTextEditor
        ref={editorRef}
        defaultValue={sampleDoc}
        images={SAMPLE_IMAGES}
        onChange={(payload) =>
          setOutput(JSON.stringify(payload.value, null, 2))
        }
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded bg-bg-brand-secondary px-3 py-1.5 text-sm font-medium text-fg-brand-secondary hover:bg-bg-brand-secondary-hover"
          onClick={() => {
            editorRef.current?.reset(sampleDoc);
            setPatchOutput("");
          }}
        >
          Reset to initial
        </button>
        <button
          type="button"
          className="rounded bg-bg-secondary px-3 py-1.5 text-sm font-medium text-fg-secondary hover:bg-bg-secondary-hover"
          onClick={() => {
            editorRef.current?.reset();
            setPatchOutput("");
          }}
        >
          Reset to empty
        </button>
        <button
          type="button"
          className="rounded bg-bg-secondary px-3 py-1.5 text-sm font-medium text-fg-secondary hover:bg-bg-secondary-hover"
          onClick={() => {
            const doc = editorRef.current?.getDocument();
            setOutput(JSON.stringify(doc, null, 2));
          }}
        >
          Get document
        </button>
        <button
          type="button"
          className="rounded bg-bg-secondary px-3 py-1.5 text-sm font-medium text-fg-secondary hover:bg-bg-secondary-hover"
          onClick={() => {
            const patches = editorRef.current?.getPatches(sampleDoc);
            setPatchOutput(JSON.stringify(patches, null, 2));
          }}
        >
          Get patches vs initial
        </button>
      </div>
      {patchOutput && (
        <div className="rounded border border-border-secondary bg-bg-secondary p-3">
          <h3 className="mb-2 text-sm font-bold text-fg-secondary">
            Patches vs initial (RFC 6902)
          </h3>
          <pre className="max-h-48 overflow-auto text-xs text-fg-secondary-alt">
            {patchOutput}
          </pre>
        </div>
      )}
      <pre className="max-h-48 overflow-auto rounded border border-border-secondary bg-bg-secondary p-3 text-xs text-fg-secondary-alt">
        {output || "(click 'Get document' to see current state)"}
      </pre>
    </div>
  );
}

export const UncontrolledWithReset: Story = {
  render: () => <UncontrolledResetStory />,
};

// 5. Readonly
export const Readonly: Story = {
  args: {
    defaultValue: sampleDoc,
    readOnly: true,
  },
};

// 6. Diff with readonly true
const diffBaseDoc: EditorDocument = [
  { tag: "h1", children: ["Original Title"] },
  {
    tag: "p",
    children: ["This is the original paragraph that was here before editing."],
  },
  { tag: "p", children: ["This paragraph will be removed."] },
];

const diffCurrentDoc: EditorDocument = [
  { tag: "h1", children: ["Updated Title"] },
  {
    tag: "p",
    children: ["This is the modified paragraph with new content added."],
  },
  { tag: "p", children: ["This is a brand new paragraph."] },
];

export const DiffReadonly: Story = {
  args: {
    defaultValue: diffCurrentDoc,
    diffBase: diffBaseDoc,
    readOnly: true,
  },
};

// 7. Diff with readonly false (write + diff)
export const DiffEditable: Story = {
  args: {
    defaultValue: diffCurrentDoc,
    diffBase: diffBaseDoc,
    readOnly: false,
  },
};

// 8. Toolbar on/off (fixed bar at top + floating bar on text selection)
export const ToolbarEnabled: Story = {
  args: {
    defaultValue: sampleDoc,
    features: { fixedToolbar: true, floatingToolbar: false },
  },
};

export const ToolbarDisabled: Story = {
  args: {
    defaultValue: sampleDoc,
    features: { fixedToolbar: false, floatingToolbar: false },
  },
};

// 9. Gutter + insert block types
export const GutterEnabled: Story = {
  args: {
    defaultValue: sampleDoc,
    features: { gutter: true },
  },
};

export const GutterDisabled: Story = {
  args: {
    defaultValue: sampleDoc,
    features: { gutter: false },
  },
};

// 10. Errors
const errorsDoc: EditorDocument = [
  { tag: "p", children: ["This paragraph has an error."] },
  {
    tag: "p",
    children: [
      "This text is fine, but ",
      { tag: "a", href: "https://broken-link.com", children: ["this link"] },
      " is broken.",
    ],
  },
  { tag: "p", children: ["Another paragraph with a custom error type."] },
];

const sampleErrors: EditorError[] = [
  {
    path: "/0",
    message: "This paragraph contains inappropriate content.",
    kind: "validation.content",
    fixes: [
      { id: "remove-content", label: "Remove paragraph" },
      { id: "replace-content", label: "Replace with default" },
    ],
  },
  {
    path: "/1/children/1",
    message: "This link points to an unreachable URL.",
    kind: "validation.link",
    fixes: [
      { id: "fix-url", label: "Fix URL" },
      { id: "remove-link", label: "Remove link" },
    ],
  },
  {
    path: "/2",
    message: "Custom rule violation: paragraph too short.",
    kind: "custom.minLength",
  },
];

function ErrorStory() {
  const [fixLog, setFixLog] = useState<string[]>([]);

  return (
    <div className="flex flex-col gap-4">
      <RichTextEditor
        defaultValue={errorsDoc}
        images={SAMPLE_IMAGES}
        errors={sampleErrors}
        onApplyErrorFix={(args) => {
          setFixLog((prev) => [
            ...prev,
            `Fix applied: path=${args.path} kind=${args.kind} fixId=${args.fixId}`,
          ]);
        }}
      />
      <div className="rounded border border-border-secondary bg-bg-secondary p-3">
        <h3 className="mb-2 text-sm font-bold text-fg-secondary">Fix log</h3>
        {fixLog.length === 0 ? (
          <p className="text-xs text-fg-secondary-alt">
            (click error fix buttons to see callbacks)
          </p>
        ) : (
          <ul className="text-xs text-fg-secondary-alt">
            {fixLog.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export const Errors: Story = {
  render: () => <ErrorStory />,
};

export const ErrorsReadonly: Story = {
  args: {
    defaultValue: errorsDoc,
    errors: sampleErrors,
    readOnly: true,
  },
};

// 11. Combined: diff + errors + readonly
export const CombinedDiffErrorsReadonly: Story = {
  args: {
    defaultValue: diffCurrentDoc,
    diffBase: diffBaseDoc,
    errors: [
      {
        path: "/1",
        message: "This edited paragraph has an issue.",
        kind: "validation.content",
        fixes: [{ id: "revert", label: "Revert change" }],
      },
    ],
    readOnly: true,
  },
};

function CombinedDiffErrorsEditableStory() {
  const [fixLog, setFixLog] = useState<string[]>([]);

  return (
    <div className="flex flex-col gap-4">
      <RichTextEditor
        defaultValue={diffCurrentDoc}
        images={SAMPLE_IMAGES}
        diffBase={diffBaseDoc}
        errors={[
          {
            path: "/0",
            message: "Title was changed - review needed.",
            kind: "review.title",
            fixes: [
              { id: "accept", label: "Accept change" },
              { id: "revert", label: "Revert" },
            ],
          },
        ]}
        onApplyErrorFix={(args) => {
          setFixLog((prev) => [
            ...prev,
            `Fix: path=${args.path} kind=${args.kind} fixId=${args.fixId}`,
          ]);
        }}
      />
      <pre className="rounded bg-bg-secondary p-2 text-xs text-fg-secondary-alt">
        {fixLog.length > 0 ? fixLog.join("\n") : "(no fixes applied yet)"}
      </pre>
    </div>
  );
}

export const CombinedDiffErrorsEditable: Story = {
  render: () => <CombinedDiffErrorsEditableStory />,
};

// 12. Link catalog
const linkCatalogItems: EditorLinkCatalogItem[] = [
  {
    title: "Acme Corp",
    subtitle: "https://acme.example.com",
    image: "https://placehold.co/64x64?text=A",
    href: "https://acme.example.com",
  },
  {
    title: "Widget Inc",
    subtitle: "https://widget.example.com",
    href: "https://widget.example.com",
  },
  {
    title: "Docs Portal",
    subtitle: "Internal documentation hub",
    image: "https://placehold.co/64x64?text=D",
    href: "https://docs.example.com",
  },
];

const linkCatalogDoc: EditorDocument = [
  {
    tag: "p",
    children: [
      "Select some text and click the link button to see the catalog picker. ",
      "Only URLs from the catalog are allowed.",
    ],
  },
  {
    tag: "p",
    children: [
      "This existing link is allowed: ",
      { tag: "a", href: "https://acme.example.com", children: ["Acme Corp"] },
    ],
  },
];

export const LinkCatalog: Story = {
  args: {
    defaultValue: linkCatalogDoc,
    linkCatalog: linkCatalogItems,
  },
};

// 13. Uncontrolled + debounced onDirty
function UncontrolledDebouncedStory() {
  const editorRef = useRef<RichTextEditorRef>(null);
  const [output, setOutput] = useState<string>("");
  const [patchOutput, setPatchOutput] = useState<string>("");
  const [dirtyCount, setDirtyCount] = useState(0);
  const [saveCount, setSaveCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDirty = useCallback(() => {
    setDirtyCount((c) => c + 1);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const doc = editorRef.current?.getDocument();
      const patches = editorRef.current?.getPatches(sampleDoc);
      setOutput(JSON.stringify(doc, null, 2));
      setPatchOutput(JSON.stringify(patches, null, 2));
      setSaveCount((c) => c + 1);
    }, 2000);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <RichTextEditor
        ref={editorRef}
        defaultValue={sampleDoc}
        images={SAMPLE_IMAGES}
        onDirty={handleDirty}
        features={{ button: true }}
        buttonVariants={[
          {
            variant: "cta-button",
            label: "CTA Button",
            children: "string",
          },
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
      <div className="flex gap-4 text-sm text-fg-secondary">
        <span>
          Keystrokes: <strong>{dirtyCount}</strong>
        </span>
        <span>
          Debounced saves: <strong>{saveCount}</strong>
        </span>
      </div>
      {patchOutput && (
        <div className="rounded border border-border-secondary bg-bg-secondary p-3">
          <h3 className="mb-2 text-sm font-bold text-fg-secondary">
            Patches vs initial (debounced, 2 s)
          </h3>
          <pre className="max-h-48 overflow-auto text-xs text-fg-secondary-alt">
            {patchOutput}
          </pre>
        </div>
      )}
      <pre className="max-h-48 overflow-auto rounded border border-border-secondary bg-bg-secondary p-3 text-xs text-fg-secondary-alt">
        {output || "(document will appear after 2 s of inactivity)"}
      </pre>
    </div>
  );
}

export const UncontrolledDebounced: Story = {
  render: () => <UncontrolledDebouncedStory />,
};

// 14. Image picker
const imagePickerDoc: EditorDocument = [
  { tag: "h1", children: ["Image Picker Demo"] },
  {
    tag: "p",
    children: [
      "Click any image below to open the picker. ",
      "Use the gutter (+) button to insert a new image.",
    ],
  },
  {
    tag: "p",
    children: [
      "An inline image: ",
      {
        tag: "img",
        src: "https://placehold.co/120x40/fce7f3/9d174d?text=Inline",
      },
      " sits within text.",
    ],
  },
];

export const ImagePicker: Story = {
  args: {
    defaultValue: imagePickerDoc,
  },
};

// 15. Button variants
const buttonSpecificCatalog: EditorLinkCatalogItem[] = [
  { title: "Home", subtitle: "/home", href: "/home" },
  { title: "About", subtitle: "/about", href: "/about" },
  { title: "Contact", subtitle: "/contact", href: "/contact" },
];

const allButtonVariants: EditorButtonVariant[] = [
  {
    variant: "link-button",
    label: "Link Button",
    children: "string",
    link: true,
  },
  {
    variant: "nav-button",
    label: "Nav Button",
    children: "string",
    link: buttonSpecificCatalog,
  },
  { variant: "cta-button", label: "CTA Button", children: false },
  { variant: "generic-button", label: "Generic Button", children: "string" },
];

const buttonVariantsDoc: EditorDocument = [
  { tag: "h2", children: ["Button Variants"] },
  {
    tag: "p",
    children: [
      "An atom button (fixed label): ",
      { tag: "button", variant: "cta-button", children: false },
      " is inserted as-is.",
    ],
  },
  {
    tag: "p",
    children: [
      "An editable button: ",
      { tag: "button", variant: "generic-button", children: ["Click me"] },
      " allows editing its label.",
    ],
  },
  {
    tag: "p",
    children: [
      "A free-form link button: ",
      {
        tag: "button",
        variant: "link-button",
        href: "https://example.com",
        children: ["Visit Example"],
      },
      " accepts any URL.",
    ],
  },
  {
    tag: "p",
    children: [
      "A catalog link button: ",
      {
        tag: "button",
        variant: "nav-button",
        href: "/home",
        children: ["Go Home"],
      },
      " picks from a button-specific catalog.",
    ],
  },
];

export const ButtonVariants: Story = {
  args: {
    defaultValue: buttonVariantsDoc,
    features: { button: true },
    buttonVariants: allButtonVariants,
  },
};

// 16. Editable buttons
const editableButtonVariants: EditorButtonVariant[] = [
  { variant: "primary-action", label: "Primary", children: "string" },
  { variant: "secondary-action", label: "Secondary", children: "string" },
];

const buttonsEditableDoc: EditorDocument = [
  { tag: "h2", children: ["Editable Buttons"] },
  {
    tag: "p",
    children: [
      "Primary: ",
      { tag: "button", variant: "primary-action", children: ["Submit Form"] },
    ],
  },
  {
    tag: "p",
    children: [
      "Secondary: ",
      { tag: "button", variant: "secondary-action", children: ["Cancel"] },
      " -- try editing the button text directly.",
    ],
  },
];

export const ButtonsEditable: Story = {
  args: {
    defaultValue: buttonsEditableDoc,
    features: { button: true },
    buttonVariants: editableButtonVariants,
  },
};

// 17. Custom styles
const customStyles: EditorStyleConfig = {
  highlight: { label: "Highlight", css: { backgroundColor: "#fef08a" } },
  danger: {
    label: "Danger",
    css: { color: "#dc2626", fontWeight: "bold" },
  },
};

const customStylesDoc: EditorDocument = [
  { tag: "h2", children: ["Custom Styles Demo"] },
  {
    tag: "p",
    children: [
      "This text has a ",
      {
        tag: "span",
        styles: ["highlight"],
        children: ["highlighted section"],
      },
      " and a ",
      { tag: "span", styles: ["danger"], children: ["danger warning"] },
      ".",
    ],
  },
  {
    tag: "p",
    children: [
      "You can also ",
      {
        tag: "span",
        styles: ["bold", "highlight"],
        children: ["combine built-in and custom styles"],
      },
      ".",
    ],
  },
  {
    tag: "p",
    children: [
      "Select text and use the toolbar to toggle ",
      { tag: "span", styles: ["highlight"], children: ["Highlight"] },
      " or ",
      { tag: "span", styles: ["danger"], children: ["Danger"] },
      " styles.",
    ],
  },
];

export const CustomStyles: Story = {
  args: {
    defaultValue: customStylesDoc,
    features: { styles: customStyles },
  },
};

function CustomStylesControlledStory() {
  const [value, setValue] = useState<EditorDocument>(customStylesDoc);

  const handleChange = useCallback((payload: EditorChangePayload) => {
    setValue(payload.value);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <RichTextEditor
        value={value}
        onChange={handleChange}
        images={SAMPLE_IMAGES}
        features={{ styles: customStyles }}
      />
      <div className="rounded border border-border-secondary bg-bg-secondary p-3">
        <h3 className="mb-2 text-sm font-bold text-fg-secondary">
          Serialized JSON
        </h3>
        <pre className="max-h-48 overflow-auto text-xs text-fg-secondary-alt">
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    </div>
  );
}

export const CustomStylesControlled: Story = {
  render: () => <CustomStylesControlledStory />,
};

// --- Details & Summary ---

const detailsVariants: EditorDetailsVariant[] = [
  { variant: "details", label: "Details" },
  { variant: "footnote", label: "Footnote" },
  { variant: "explanation", label: "Explanation" },
];

const detailsSampleDoc: EditorDocument = [
  { tag: "h2", children: ["Details & Summary"] },
  {
    tag: "p",
    children: ["The editor supports collapsible details blocks with variants."],
  },
  {
    tag: "details",
    children: [
      { tag: "summary", children: ["Click to expand (default variant)"] },
      {
        tag: "p",
        children: ["This is the hidden content of a default details block."],
      },
      { tag: "p", children: ["It can contain multiple paragraphs."] },
    ],
  },
  {
    tag: "details",
    variant: "footnote",
    children: [
      { tag: "summary", children: ["Footnote 1"] },
      {
        tag: "p",
        children: [
          "This is footnote content, useful for references and citations.",
        ],
      },
    ],
  },
  {
    tag: "details",
    variant: "explanation",
    children: [
      {
        tag: "summary",
        children: [
          { tag: "span", styles: ["bold"], children: ["Explanation"] },
          " — technical detail",
        ],
      },
      {
        tag: "p",
        children: ["This explanation variant can hold rich content:"],
      },
      {
        tag: "ul",
        children: [
          { tag: "li", children: [{ tag: "p", children: ["First point"] }] },
          { tag: "li", children: [{ tag: "p", children: ["Second point"] }] },
        ],
      },
    ],
  },
];

function DetailsAndSummaryStory() {
  const [value, setValue] = useState<EditorDocument>(detailsSampleDoc);
  const [patches, setPatches] = useState<string>("");

  const handleChange = useCallback((payload: EditorChangePayload) => {
    setValue(payload.value);
    setPatches(JSON.stringify(payload.patches, null, 2));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <RichTextEditor
        value={value}
        onChange={handleChange}
        images={SAMPLE_IMAGES}
        features={{ details: true }}
        detailsVariants={detailsVariants}
      />
      <div className="rounded border border-border-secondary bg-bg-secondary p-3">
        <h3 className="mb-2 text-sm font-bold text-fg-secondary">
          Patches (RFC 6902)
        </h3>
        <pre className="max-h-48 overflow-auto text-xs text-fg-secondary-alt">
          {patches || "(no changes yet)"}
        </pre>
      </div>
      <div className="rounded border border-border-secondary bg-bg-secondary p-3">
        <h3 className="mb-2 text-sm font-bold text-fg-secondary">
          Current Value
        </h3>
        <pre className="max-h-48 overflow-auto text-xs text-fg-secondary-alt">
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    </div>
  );
}

export const DetailsAndSummary: Story = {
  render: () => <DetailsAndSummaryStory />,
};

// Schema validation errors
const schemaViolationDoc: EditorDocument = [
  { tag: "h1", children: ["This heading is not allowed"] },
  {
    tag: "p",
    children: [
      "Normal paragraph with ",
      { tag: "span", styles: ["bold"], children: ["bold text"] },
      " that is not allowed.",
    ],
  },
  {
    tag: "ul",
    children: [
      { tag: "li", children: [{ tag: "p", children: ["List item 1"] }] },
      { tag: "li", children: [{ tag: "p", children: ["List item 2"] }] },
    ],
  },
  {
    tag: "blockquote",
    children: [{ tag: "p", children: ["A blockquote that violates schema"] }],
  },
  {
    tag: "p",
    children: [
      "A link: ",
      { tag: "a", href: "https://example.com", children: ["click here"] },
    ],
  },
];

export const SchemaViolationErrors: Story = {
  args: {
    defaultValue: schemaViolationDoc,
    features: {
      h1: false,
      h2: false,
      h3: false,
      h4: false,
      h5: false,
      h6: false,
      bold: false,
      bulletList: false,
      blockquote: false,
      link: false,
    },
  },
};

export const SchemaViolationWithExternalErrors: Story = {
  args: {
    defaultValue: schemaViolationDoc,
    features: {
      h1: false,
      h2: false,
      h3: false,
      h4: false,
      h5: false,
      h6: false,
      bold: false,
      bulletList: false,
      blockquote: false,
      link: false,
    },
    errors: [
      {
        path: "/1",
        message: "This paragraph also has an external validation error.",
        kind: "validation.content",
        fixes: [{ id: "fix-it", label: "Fix content" }],
      },
    ],
  },
};
