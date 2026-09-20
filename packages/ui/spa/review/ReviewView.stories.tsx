import type { Meta, StoryObj } from "@storybook/react";
import { ReviewView } from "./ReviewView";
import {
  emptyReviewModel,
  noStagingReviewModel,
  partialStagingReviewModel,
  reviewModel,
} from "./fixtures";
import type { ReviewModel } from "./types";

/**
 * The `/val/review` page, on fixtures rather than on a store.
 *
 * Nothing here mounts a system or a patch chain. The page renders a
 * `ReviewModel` — see `types.ts` for why that is a separate shape from
 * `SerializedPatchSet` — so these stories are the layout under discussion and
 * not a test of the adapter that will eventually feed it.
 *
 * The content is the same publish the compare fixtures describe, deliberately:
 * the two screens are meant to be opened one after the other, and a fixture
 * that told a different story would hide whether they agree.
 */
function Harness({ model }: { model: ReviewModel }) {
  return (
    <div className="h-screen w-full bg-bg-primary">
      <ReviewView
        model={model}
        onCompare={() => undefined}
        onStage={() => undefined}
        onUnstage={() => undefined}
        onDiscard={() => undefined}
        onDiscardAll={() => undefined}
      />
    </div>
  );
}

const meta: Meta<typeof Harness> = {
  title: "Review/Review page",
  component: Harness,
  parameters: { layout: "fullscreen" },
  args: { model: reviewModel },
};
export default meta;
type Story = StoryObj<typeof Harness>;

/**
 * The whole page: four modules, nine patch sets, two of them held back.
 *
 * What to look at, in the order the decisions were made:
 *
 * - **No diffs, anywhere.** This page answers "what is going out", and the
 *   existing `/val/compare` answers "what changed". A publish decision is made
 *   over the whole list, and a list of diffs cannot be read whole.
 * - **One Compare button, at the top.** Not one per row: a publish ships the
 *   staged set as a unit, and a per-row dialog would open a compare whose nav
 *   had a single entry in it.
 * - **A row is a patch set**, which is the unit staging moves and discard
 *   removes. Finer would offer a control that cannot be honoured; coarser is
 *   the module, which routinely holds two unrelated edits by two people.
 * - **The held rows still have a Discard button.** A change you are not
 *   publishing is exactly the one you may want gone.
 * - **`Getting started with Val` says whose work it drags in.** Staging a later
 *   patch set cannot leave its predecessors behind — the prefix invariant — so
 *   the names are on the row, before the click, not in a confirmation after it.
 */
export const Default: Story = {};

/** The same page in light mode. */
export const Light: Story = { globals: { theme: "light" } };

/**
 * Nothing pending, which is what this page shows most of the time.
 *
 * Says what would appear here rather than just being blank: an editor who has
 * never published does not know that this is where changes collect.
 */
export const Empty: Story = { args: { model: emptyReviewModel } };

/**
 * fs mode, where the server cannot store patch groups.
 *
 * Every checkbox is gone rather than present and inert — the rule
 * `PatchStaging.enabled` already states, and the reason it exists: a control
 * that silently does nothing is worse than no control. Discard stays, because
 * discarding a patch does not need a group to put it in.
 */
export const NoStaging: Story = { args: { model: noStagingReviewModel } };

/**
 * One patch set mid-flight, so the third checkbox state is on screen.
 *
 * `partial` is transient — a patch set is the unit staging moves — but it has
 * to be drawable, because the alternative is a checkbox that reads as settled
 * while it is not.
 */
export const PartiallyStaged: Story = {
  args: { model: partialStagingReviewModel },
};
