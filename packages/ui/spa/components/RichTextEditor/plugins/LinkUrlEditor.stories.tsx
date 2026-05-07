import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { LinkUrlEditor } from "./LinkUrlEditorComponent";

const meta: Meta<typeof LinkUrlEditor> = {
  title: "RichTextEditor/LinkUrlEditor",
  component: LinkUrlEditor,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-md p-4">
        <div className="flex items-center gap-1.5 rounded-md border border-border-primary bg-bg-primary p-1.5 shadow-lg">
          <Story />
        </div>
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof LinkUrlEditor>;

export const NewLink: Story = {
  args: {
    currentHref: "",
    isNewLink: true,
    onApply: (href) => console.log("Apply:", href),
    onUnlink: () => console.log("Unlink"),
    onClose: () => console.log("Close"),
  },
};

export const ExistingLink: Story = {
  args: {
    currentHref: "https://example.com/page",
    isNewLink: false,
    onApply: (href) => console.log("Update:", href),
    onUnlink: () => console.log("Unlink"),
    onClose: () => console.log("Close"),
  },
};

export const MailtoLink: Story = {
  args: {
    currentHref: "mailto:hello@example.com",
    isNewLink: false,
    onApply: (href) => console.log("Update:", href),
    onUnlink: () => console.log("Unlink"),
    onClose: () => console.log("Close"),
  },
};

function InteractiveStory() {
  const [lastApplied, setLastApplied] = useState<string | null>(null);
  const [isLinked, setIsLinked] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1.5 rounded-md border border-border-primary bg-bg-primary p-1.5 shadow-lg">
        <LinkUrlEditor
          currentHref={lastApplied ?? ""}
          isNewLink={!isLinked}
          onApply={(href) => {
            setLastApplied(href);
            setIsLinked(true);
          }}
          onUnlink={() => {
            setLastApplied(null);
            setIsLinked(false);
          }}
          onClose={() => console.log("Close")}
        />
      </div>
      <div className="rounded border border-border-secondary bg-bg-secondary p-3">
        <div className="text-sm font-bold text-fg-secondary">State</div>
        <pre className="mt-1 text-xs text-fg-secondary-alt">
          {JSON.stringify({ lastApplied, isLinked }, null, 2)}
        </pre>
      </div>
    </div>
  );
}

export const Interactive: Story = {
  render: () => <InteractiveStory />,
};
