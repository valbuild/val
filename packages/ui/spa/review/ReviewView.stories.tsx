import type { Meta, StoryObj } from "@storybook/react";
import { ReviewView, type ReviewPublishSelected } from "./ReviewView";
import type { PublishSelectedState } from "./usePublishSelected";
import { TooltipProvider } from "../components/designSystem/tooltip";
import { emptyReviewModel, fsReviewModel, reviewModel } from "./fixtures";
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
  publishSelected,
}: {
  model: ReviewModel;
  initialSelection?: string[];
  /** Offered: the site of a project with proposals. */
  publishSelected?: PublishSelectedState;
}) {
  return (
    /*
     * `ValProvider` mounts one in the Studio; a story mounts no provider at
     * all, so any tooltip on the page needs one here or Radix has nothing to
     * attach it to.
     */
    <TooltipProvider>
      <div className="h-screen w-full bg-bg-primary">
        <ReviewView
          model={model}
          initialSelection={initialSelection}
          onCompare={() => undefined}
          /*
           * Absent in fs mode, which is what the Fs story is: there is no
           * published history there, so the button would lead to a page whose
           * only content is an apology.
           */
          onRestore={model.mode === "fs" ? undefined : () => undefined}
          onDiscard={() => undefined}
          onDiscardAll={() => undefined}
          publishSelected={
            publishSelected === undefined
              ? undefined
              : publishSelectedOf(publishSelected)
          }
        />
      </div>
    </TooltipProvider>
  );
}

/**
 * Publish selected on fixtures: a selection with Ada's heading in it pulls in
 * Linus's change to the same list, which is what the confirm has to say.
 */
function publishSelectedOf(state: PublishSelectedState): ReviewPublishSelected {
  return {
    plan: (rowIds) =>
      rowIds.includes("landing-heading")
        ? {
            count: rowIds.length + 2,
            added: 2,
            addedAuthors: ["profile-linus"],
          }
        : { count: rowIds.length, added: 0, addedAuthors: [] },
    state,
    onPublish: () => undefined,
    onRetry: () => undefined,
    onOpenProposal: () => undefined,
    onDismiss: () => undefined,
  };
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
 * The whole page: four modules, nine patch sets.
 *
 * What to look at, in the order the decisions were made:
 *
 * - **No diffs, anywhere.** This page answers "what is going out", and the
 *   existing `/val/compare` answers "what changed". A publish decision is made
 *   over the whole list, and a list of diffs cannot be read whole.
 * - **The checkbox is a selection.** It picks rows to act on; every row on
 *   the page goes out with the next publish.
 * - **Filter, then select, then act — in that order.** The author menu narrows
 *   the LIST; the tick boxes pick from what is showing; the buttons act on the
 *   ticks. It was one control before, a chip per author that ticked that
 *   person's rows, and that selected rows which were not on screen.
 * - **The menu is the compare dialog's own.** Same component, same avatars,
 *   same "(you)", so the way you pick a person has one implementation.
 * - **A row is a patch set**, which is the unit a selection picks and a revert
 *   removes. Finer would offer a control that cannot be honoured; coarser is
 *   the module, which routinely holds two unrelated edits by two people.
 * - **No file paths.** `App / Blogs / Blog` is the same location
 *   `/app/blogs/[blog]/page.val.ts` was, spelled for someone who has never
 *   seen a Next route and has no checkout to open it in.
 * - **Revert and Restore are different buttons.** Revert drops a pending change
 *   that never shipped; Restore goes to history for something that did. See
 *   `undoWords` — the words are shared with the compare dialog, which is the
 *   only way they stay the same words.
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
 * Ada's own four rows selected, across three modules.
 *
 * What you get by narrowing the author filter to yourself and pressing
 * "Select showing" — the state, reached in two gestures rather than by a
 * "Mine" preset, which the page does not have. Kept as a story because the
 * STATE is what the bulk actions have to be right about, however it was
 * arrived at.
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
 * fs mode.
 *
 * **Restore from history is gone.** `ValOpsFS` answers
 * `not-supported-in-fs-mode`; local dev has git, not a commit archive. The top
 * bar hides its own History button on the same test, and two ways in that
 * disagree about whether a feature exists is worse than one.
 */
export const Fs: Story = { args: { model: fsReviewModel } };

/**
 * One author's picture, the other's initials, from the one avatar component.
 *
 * Ada's profile has an `avatar.url` and Linus's does not, which is the pair
 * worth having on screen: `ProfileAvatar` layers the picture over the initials
 * rather than swapping it in, so a profile with no picture — or one whose
 * picture 404s — shows initials instead of an empty circle.
 *
 * This page could draw neither until recently. It declared its own
 * `{ fullName, avatar?: string | null }` and cast it to `Profile` at the one
 * place it rendered, so `profile.avatar?.url` was `undefined` for everyone and
 * every author was initials forever, while the same person had a face in the
 * shell three inches away.
 */
export const Avatars: Story = {
  args: { initialSelection: ["landing-heading"] },
};

/**
 * Publish selected, offered: on the site of a project with proposals. Press it
 * with "Landing page — heading" ticked to see the confirm name Linus's two
 * changes that have to come with it.
 */
export const PublishSelected: Story = {
  args: {
    initialSelection: ["landing-heading", "authors-erlamd"],
    publishSelected: { kind: "idle" },
  },
};

/** Under way: the button waits, and the line says how many are going. */
export const PublishSelectedPublishing: Story = {
  args: { publishSelected: { kind: "publishing", count: 3 } },
};

/** Done: the rows have gone from the list, and the line says where. */
export const PublishSelectedPublished: Story = {
  args: { publishSelected: { kind: "published", count: 3 } },
};

/**
 * Stopped after the move: the changes are safe in their proposal, so the line
 * offers to open it as well as to try again.
 */
export const PublishSelectedFailed: Story = {
  args: {
    publishSelected: {
      kind: "failed",
      count: 3,
      message: "Building the site failed on /pricing.",
      proposal: "0123456789abcdef0123",
      canRetry: true,
    },
  },
};

/**
 * Refused before anything moved: the site was published meanwhile. Nothing is
 * in a proposal, so there is nothing to open -- only Try again.
 */
export const PublishSelectedRefused: Story = {
  args: {
    publishSelected: {
      kind: "failed",
      count: 3,
      message:
        "The site was published while this was being prepared. Nothing was published: publish them again.",
      proposal: null,
      canRetry: true,
    },
  },
};
