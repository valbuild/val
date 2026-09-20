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
function Harness({
  model,
  initialSelection,
}: {
  model: ReviewModel;
  initialSelection?: string[];
}) {
  return (
    <div className="h-screen w-full bg-bg-primary">
      <ReviewView
        model={model}
        initialSelection={initialSelection}
        onCompare={() => undefined}
        onRestore={() => undefined}
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
 * - **Two sections, and the checkbox is neither of them.** Staged-ness is the
 *   section a row sits in; the tick is a SELECTION of rows to act on. One
 *   control cannot answer "is this going out" and "am I about to change that"
 *   without each answer being mistaken for the other.
 * - **The presets are the point of the checkboxes.** "Mine" before a publish
 *   is the commonest thing an editor wants — ship what I did, leave the rest —
 *   and it is one click rather than nine.
 * - **A row is a patch set**, which is the unit staging moves and a revert
 *   removes. Finer would offer a control that cannot be honoured; coarser is
 *   the module, which routinely holds two unrelated edits by two people.
 * - **No file paths.** `App / Blogs / Blog` is the same location
 *   `/app/blogs/[blog]/page.val.ts` was, spelled for someone who has never
 *   seen a Next route and has no checkout to open it in.
 * - **Revert and Restore are different buttons.** Revert drops a staged change
 *   that never shipped; Restore goes to history for something that did. See
 *   `undoWords` — the words are shared with the compare dialog, which is the
 *   only way they stay the same words.
 * - **`Getting started with Val` says whose work it drags in.** Staging a later
 *   patch set cannot leave its predecessors behind — the prefix invariant — so
 *   the names are on the row, before the click, not in a confirmation after it.
 */
export const Default: Story = {};

/**
 * Mid-selection: three rows ticked, so the action bar is live.
 *
 * The bar is on screen with nothing selected too, and that is deliberate — a
 * bar that appears on the first tick moves every row under the cursor at the
 * exact moment someone is aiming at a checkbox. This is what it looks like once
 * it has something to act on.
 */
export const Selecting: Story = {
  args: {
    initialSelection: ["landing-heading", "landing-badge", "authors-erlamd"],
  },
};

/**
 * What the "Mine" preset produces for Ada: her four rows, across three modules
 * and both sections.
 *
 * Both sections on purpose. A preset selects by WHO, not by where the row
 * already is, so pressing Stage here pulls her held-back blog change into the
 * publish and leaves Linus's alone — which is the sentence the preset exists
 * to make one gesture.
 */
export const MineSelected: Story = {
  args: {
    initialSelection: [
      "landing-badge",
      "authors-erlamd",
      "blogs-getting-started",
      "media-hero",
    ],
  },
};

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
 * Stage and Unstage are gone rather than present and inert — the rule
 * `PatchStaging.enabled` already states, and the reason it exists: a control
 * that silently does nothing is worse than no control. The checkboxes stay,
 * because selecting rows to revert works without a group to put them in, and
 * so does the Held back section — empty, saying so.
 */
export const NoStaging: Story = { args: { model: noStagingReviewModel } };

/**
 * One patch set mid-flight, so the third staging state is on screen.
 *
 * `partial` is transient — a patch set is the unit staging moves — but it has
 * to be drawable, and it sits with the staged rows: a row halfway into the
 * publish is in the publish. The badge is what says it is not settled, now that
 * the checkbox means something else.
 */
export const PartiallyStaged: Story = {
  args: { model: partialStagingReviewModel },
};
