import type { Meta, StoryObj } from "@storybook/react";
import { useMemo, useState } from "react";
import { DetailsEditorModal } from "./DetailsEditorModal";
import { buildSchema } from "../schema";
import type { Node as PMNode } from "prosemirror-model";

function useStorySchema() {
  return useMemo(() => buildSchema({ features: { details: true } }), []);
}

function ModalStory({
  summaryText,
  bodyTexts,
}: {
  summaryText: string;
  bodyTexts: string[];
}) {
  const schema = useStorySchema();
  const [open, setOpen] = useState(true);
  const [result, setResult] = useState<string | null>(null);

  const summaryContent = useMemo(
    () => (summaryText ? [schema.text(summaryText)] : []),
    [schema, summaryText],
  );

  const bodyNodes = useMemo(
    () =>
      bodyTexts.map((text) =>
        schema.node("paragraph", null, text ? [schema.text(text)] : []),
      ),
    [schema, bodyTexts],
  );

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        className="w-fit rounded bg-bg-brand-secondary px-3 py-1.5 text-sm font-medium text-fg-brand-secondary hover:bg-bg-brand-secondary-hover"
        onClick={() => {
          setOpen(true);
          setResult(null);
        }}
      >
        Open modal
      </button>
      {open && (
        <DetailsEditorModal
          schema={schema}
          summaryContent={summaryContent}
          bodyNodes={bodyNodes}
          onSave={(summary: PMNode[], body: PMNode[]) => {
            setResult(
              JSON.stringify(
                {
                  summaryNodeCount: summary.length,
                  bodyNodeCount: body.length,
                },
                null,
                2,
              ),
            );
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      )}
      {result && (
        <div className="rounded border border-border-secondary bg-bg-secondary p-3">
          <div className="text-sm font-bold text-fg-secondary">Save result</div>
          <pre className="mt-1 text-xs text-fg-secondary-alt">{result}</pre>
        </div>
      )}
    </div>
  );
}

const meta: Meta<typeof DetailsEditorModal> = {
  title: "RichTextEditor/DetailsEditorModal",
  component: DetailsEditorModal,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof DetailsEditorModal>;

export const EmptyBody: Story = {
  render: () => <ModalStory summaryText="Click to expand" bodyTexts={[]} />,
};

export const WithContent: Story = {
  render: () => (
    <ModalStory
      summaryText="FAQ: How does billing work?"
      bodyTexts={[
        "Billing is processed monthly on the first of each month.",
        "You can upgrade or downgrade your plan at any time.",
      ]}
    />
  ),
};

export const LongSummary: Story = {
  render: () => (
    <ModalStory
      summaryText="This is a very long summary text that might wrap to multiple lines in the mini editor, testing how the component handles overflow"
      bodyTexts={["Content beneath the long summary."]}
    />
  ),
};

function MultipleEditsStory() {
  const schema = useStorySchema();
  const [open, setOpen] = useState(false);
  const [editCount, setEditCount] = useState(0);

  const summaryContent = useMemo(
    () => [schema.text(`Edit #${editCount + 1}`)],
    [schema, editCount],
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      <button
        type="button"
        className="w-fit rounded bg-bg-brand-secondary px-3 py-1.5 text-sm font-medium text-fg-brand-secondary hover:bg-bg-brand-secondary-hover"
        onClick={() => setOpen(true)}
      >
        Open modal ({editCount} saves)
      </button>
      {open && (
        <DetailsEditorModal
          schema={schema}
          summaryContent={summaryContent}
          bodyNodes={[]}
          onSave={() => {
            setEditCount((c) => c + 1);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export const MultipleEdits: Story = {
  render: () => <MultipleEditsStory />,
};
