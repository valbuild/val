import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ErrorTooltip } from "./ErrorTooltipComponent";
import type { EditorError } from "../types";

const meta: Meta<typeof ErrorTooltip> = {
  title: "RichTextEditor/ErrorTooltip",
  component: ErrorTooltip,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-sm p-4">
        <div className="rounded-md border border-border-primary bg-bg-primary p-3 shadow-lg">
          <Story />
        </div>
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ErrorTooltip>;

export const WithoutFixes: Story = {
  args: {
    error: {
      path: "/0",
      message: "This paragraph contains inappropriate content.",
      kind: "validation.content",
    },
  },
};

export const SingleFix: Story = {
  args: {
    error: {
      path: "/1/children/1",
      message: "This link points to an unreachable URL.",
      kind: "validation.link",
      fixes: [{ id: "fix-url", label: "Fix URL" }],
    },
    onApplyFix: (args) => console.log("Fix applied:", args),
  },
};

export const MultipleFixes: Story = {
  args: {
    error: {
      path: "/0",
      message: "This paragraph contains inappropriate content.",
      kind: "validation.content",
      fixes: [
        { id: "remove-content", label: "Remove paragraph" },
        { id: "replace-content", label: "Replace with default" },
        { id: "ignore", label: "Ignore" },
      ],
    },
    onApplyFix: (args) => console.log("Fix applied:", args),
  },
};

export const LongMessage: Story = {
  args: {
    error: {
      path: "/2",
      message:
        "Schema validation failed: the heading node type is not allowed by the current feature configuration. " +
        "Please remove this heading or enable the heading feature.",
      kind: "schema.violation",
      fixes: [
        { id: "convert-to-paragraph", label: "Convert to paragraph" },
        { id: "remove-node", label: "Remove" },
      ],
    },
    onApplyFix: (args) => console.log("Fix applied:", args),
  },
};

function InteractiveStory() {
  const [fixLog, setFixLog] = useState<string[]>([]);

  const errors: EditorError[] = [
    {
      path: "/0",
      message: "Title was changed \u2014 review needed.",
      kind: "review.title",
      fixes: [
        { id: "accept", label: "Accept change" },
        { id: "revert", label: "Revert" },
      ],
    },
    {
      path: "/1",
      message: "Broken link detected.",
      kind: "validation.link",
      fixes: [{ id: "fix-url", label: "Fix URL" }],
    },
    {
      path: "/2",
      message: "Custom rule violation: paragraph too short.",
      kind: "custom.minLength",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {errors.map((error, i) => (
        <div
          key={i}
          className="rounded-md border border-border-primary bg-bg-primary p-3 shadow-lg"
        >
          <ErrorTooltip
            error={error}
            onApplyFix={(args) =>
              setFixLog((prev) => [
                ...prev,
                `${args.kind}: ${args.fixId} (path: ${args.path})`,
              ])
            }
          />
        </div>
      ))}
      <div className="rounded border border-border-secondary bg-bg-secondary p-3">
        <div className="text-sm font-bold text-fg-secondary">Fix log</div>
        {fixLog.length === 0 ? (
          <p className="mt-1 text-xs text-fg-secondary-alt">
            (click fix buttons to see callbacks)
          </p>
        ) : (
          <ul className="mt-1 text-xs text-fg-secondary-alt">
            {fixLog.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export const Interactive: Story = {
  render: () => <InteractiveStory />,
};
