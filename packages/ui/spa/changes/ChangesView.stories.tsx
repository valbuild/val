import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { ChangesView } from "./ChangesView";
import {
  changesModel,
  emptyChangesModel,
  localChangesModel,
  NOW,
  SECTIONS_ROW_ID,
  TITLE_ROW_ID,
} from "./fixtures";
import type { ChangesModel } from "./types";

/**
 * The Changes page, on fixtures.
 *
 * Reverting works inside the story: the steps that go are removed from the
 * list, so the confirmation and what it takes along can be tried. Reload the
 * story to get them back.
 */
function Harness({
  model: initial,
  focusRowId: initialFocus = null,
  history = true,
}: {
  model: ChangesModel;
  /** Arrive from a change in Review: only its steps are listed. */
  focusRowId?: string | null;
  /** Whether there is a published history to restore from. */
  history?: boolean;
}) {
  const [model, setModel] = useState(initial);
  const [focusRowId, setFocusRowId] = useState(initialFocus);
  return (
    <div className="h-screen w-full">
      <ChangesView
        model={model}
        now={NOW}
        focusRowId={focusRowId}
        onClearFocus={() => setFocusRowId(null)}
        onRevert={(stepIds) => {
          const gone = new Set(stepIds);
          setModel({
            ...model,
            steps: model.steps.filter((step) => !gone.has(step.id)),
          });
        }}
        onBack={() => undefined}
        onRestore={history ? () => undefined : undefined}
        onOpenSession={() => undefined}
      />
    </div>
  );
}

const meta: Meta<typeof Harness> = {
  title: "Review (proposed)/Changes and revert",
  component: Harness,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof Harness>;

/**
 * Arriving with your own changes selected. One of Ada's is selected too: she
 * edited a section you added, so it cannot stay if yours goes.
 */
export const YoursSelected: Story = {
  args: { model: changesModel },
};

/** From "History" on the title in Review: the two edits behind that change. */
export const StepsBehindOneChange: Story = {
  args: { model: changesModel, focusRowId: TITLE_ROW_ID },
};

/** From "History" on a list: three steps by two people. */
export const StepsBehindOneList: Story = {
  args: { model: changesModel, focusRowId: SECTIONS_ROW_ID },
};

/** A local project: one author, and no published history to restore from. */
export const LocalProject: Story = {
  args: { model: localChangesModel, history: false },
};

/** Nothing pending. */
export const Empty: Story = {
  args: { model: emptyChangesModel },
};
