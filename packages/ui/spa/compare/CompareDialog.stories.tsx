import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { CompareDialog } from "./CompareDialog";
import {
  commitBasisModel,
  compareModel,
  emptyModel,
  longCommitMessageModel,
  revertBasisModel,
  singleModuleModel,
} from "./fixtures";
import type { CompareModel } from "./types";

/**
 * The compare dialog, on fixtures rather than on a store.
 *
 * Nothing here mounts a system, a worker or a patch chain. The dialog renders a
 * `CompareModel` — see `types.ts` for why that is a separate shape from
 * `ChangeTreeNode` — so these stories are the design under iteration and not a
 * test of the adapter that will eventually feed it.
 *
 * The values in the cells are plain spans and coloured swatches. In the product
 * they become real fields rendered under a source override, the way
 * `ComparePatchSets` already does it; the layout takes `ReactNode` on both
 * sides precisely so that swap changes nothing here.
 *
 * Theme, portal and tooltip providers come from `.storybook/preview.tsx`, so
 * light and dark are chosen with the `theme` global rather than by a wrapper
 * here — which also means the toolbar toggle works on every one of these.
 */

function Harness({
  model,
  layout,
  authorFilter,
  undoPicks,
  density,
}: {
  model: CompareModel;
  layout?: "desktop" | "mobile";
  authorFilter?: string | null;
  undoPicks?: string[];
  density?: "full" | "reduced";
}) {
  const [basisId, setBasisId] = useState(model.selectedBasisId);
  return (
    <div className="flex h-screen w-full items-center justify-center bg-bg-secondary">
      <CompareDialog
        open
        onOpenChange={() => undefined}
        model={{ ...model, selectedBasisId: basisId }}
        onSelectBasis={setBasisId}
        forceLayout={layout}
        initialAuthorFilter={authorFilter ?? null}
        initialUndoPicks={undoPicks}
        density={density}
        currentAuthorId="profile-linus"
        onUndo={() => undefined}
        onRevertAll={() => undefined}
      />
    </div>
  );
}

const meta: Meta<typeof Harness> = {
  title: "Compare/Staged changes dialog",
  component: Harness,
  parameters: { layout: "fullscreen" },
  args: { model: compareModel },
};
export default meta;
type Story = StoryObj<typeof Harness>;

/**
 * The whole thing: a page edited, a page added, a page removed, three modules
 * and a gallery, with the landing page selected on arrival.
 *
 * The landing pane is the one that shows all four field states at once — a
 * changed string, a changed colour, an added field and a removed one — so the
 * rails and the absent-value placeholders can be judged side by side.
 */
export const Default: Story = {};

/** The same publish in light mode, because the rails carry meaning in both. */
export const Light: Story = { globals: { theme: "light" } };

/**
 * A record with all four item kinds in it.
 *
 * Select `authors.val.ts` in the nav. Added and removed entries are one line
 * each; only the edited one opens into a field diff, which is the rule the list
 * layout exists to express.
 */
export const RecordWithAddedAndRemoved: Story = {};

/**
 * An array that was reordered as well as edited.
 *
 * Select `lists.val.ts`. `moved` is the fourth mark — array items splice, so a
 * reorder is a real change that is not an edit, and calling it one would make
 * every row below the move look changed. `ArrayFields` emits a real
 * `{op: "move"}` for a drag, so this is read rather than inferred.
 */
export const ArrayWithMoves: Story = {};

/**
 * A page that changed URL.
 *
 * The other half of `moved`, and the consequential one: in a router record the
 * key IS the address, and `ChangeRecordPopover` renames it with a real
 * `{op: "move"}` while rewriting every referrer it found. So this is one row
 * saying "renamed", not an add beside a remove — and the nav row carries the
 * old URL so a publish can be scanned for broken links without opening
 * anything. Select `/blogs/history-and-restore` under Pages.
 */
export const RenamedRoute: Story = {};

/**
 * Who staged each change.
 *
 * Avatars sit on the RIGHT column only: the left is published content nobody
 * is currently editing, so there is no editor to name there. Clicking one opens
 * `FieldPatchAuthorsPure` — the same popover the current review screen uses,
 * listing every patch behind that row with its op icon and time — rather than a
 * second attribution component to keep in step.
 *
 * `heading` is the one to look at: two people, three patches.
 */
export const Authors: Story = {};

/**
 * Narrowed to one person.
 *
 * The nav drops rows nobody-but-them touched, and the diff drops their
 * colleagues' rows. Rows with no author at all — group headings, unchanged
 * rows revealed by the toggle — survive, because they are structure rather
 * than somebody else's work.
 */
export const FilteredToOneAuthor: Story = {
  args: { authorFilter: "profile-linus" },
};

/**
 * Comparing against a commit instead of against published.
 *
 * Only the side labels differ, which is the whole claim the basis dropdown
 * makes: one compare surface, reachable from Publish and from History.
 *
 * Attribution changes shape here, though: a commit has ONE author, so the left
 * column names them in its header ("by Linus Pauling") rather than per row.
 * The right column keeps its per-row avatars, because those answer a different
 * question — who staged this particular change.
 */
export const AgainstACommit: Story = { args: { model: commitBasisModel } };

/**
 * A commit message long enough to break the header.
 *
 * Three different clipping contexts have to survive it, and each fails
 * differently: the dropdown TRIGGER (a flex child, which will not shrink below
 * its content unless told to, and overflowed the dialog and slid under the
 * close button), the column HEADING (a grid cell, which clips but then hides
 * the message), and the phone TAB. All three truncate and carry the full text
 * in a `title`.
 */
export const LongCommitMessage: Story = {
  args: { model: longCommitMessageModel },
};

/** The same long label on a phone, where the tab is the only header. */
export const LongCommitMessageMobile: Story = {
  args: { model: longCommitMessageModel, layout: "mobile" },
};

/**
 * One module, three fields, two of them unchanged.
 *
 * The case for the "Show all fields" toggle: with changed-only on, this pane is
 * a single row, and the toggle in the toolbar says how much it is hiding.
 */
export const ShowAllFields: Story = { args: { model: singleModuleModel } };

/**
 * Undo mode, with nothing picked yet.
 *
 * Entered from the header rather than always on: this is a reading surface,
 * and the old review screen's problem was mixing reading with discarding. The
 * bar is visible from the moment the mode opens — one that appeared on first
 * selection would shift the rows under the cursor at the exact moment someone
 * is aiming at a checkbox.
 */
export const UndoMode: Story = { args: { undoPicks: [] } };

/**
 * Undo from the nav and from a group heading.
 *
 * A nav row stands for every selectable row in its pane and its children's —
 * so ticking `blogs` means every changed page under it. A group heading stands
 * for its own rows. Both are tri-state, because a half-selected set has to say
 * so: ticking a two-state box that was already "some" looks like it did
 * nothing, and unticking it looks like it did too much.
 *
 * Ticking one entry in `authors.val.ts` therefore puts its group heading AND
 * its nav row into the indeterminate state — three levels agreeing.
 *
 * This is why the selection is model-wide rather than cleared on navigation: a
 * nav row spans panes by construction, and the nav is where that is visible.
 */
export const UndoFromNavAndGroups: Story = { args: { undoPicks: [] } };

/** Undo mode on a phone, where the nav is a drawer. */
export const UndoModeMobile: Story = {
  args: { undoPicks: [], layout: "mobile" },
};

/**
 * A discard that drags two later changes along, one of them somebody else's.
 *
 * `brand` cannot go alone: `badge` and `legacyNote` were written against a
 * state in which it applied, so the prefix invariant compels them. They are
 * ticked and marked as required rather than silently included, and the bar
 * counts them apart from the pick and names Ada, whose work is in there.
 *
 * This is the outcome the whole design is arranged around — a click that
 * quietly discards a colleague's edit is the worst thing this feature could
 * do.
 */
export const DiscardPullsInDependents: Story = {
  args: { undoPicks: ["brand"] },
};

/**
 * Two independent picks, so unticking can be shown to be surgical.
 *
 * `brand` compels `badge` and `legacyNote`; `heading` compels nothing. Untick
 * `legacyNote` and the whole `brand` group goes — it has to, a dependent cannot
 * stay behind once its predecessor is refused — while `heading` is untouched.
 *
 * The earlier version cleared the entire selection on any untick. Never wrong,
 * always annoying: it threw away picks that had nothing to do with the row
 * being unticked, and left no way to say "not that one" without starting over.
 */
export const DiscardUntickIsSurgical: Story = {
  args: { undoPicks: ["brand", "heading"] },
};

/**
 * Reverting to a commit, where the schema is the question.
 *
 * All three of `checkCompatibility`'s answers on one screen: `heading` is
 * fine, `intro` is rich text and therefore `unknown` — offered anyway, because
 * this gate cannot see the value and the real check runs at confirm — and
 * `cta` became a union with no variant of the old shape, so it is refused with
 * the reason where its checkbox would be.
 *
 * The bar also carries `revertAll`, which exists because "a publish went wrong
 * and they want it undone, all of it, now" is the case people actually have.
 */
export const RevertToCommit: Story = {
  args: { model: revertBasisModel, undoPicks: [] },
};

/**
 * Nothing staged.
 *
 * Each section says "No changes" rather than vanishing, so an empty Media
 * section cannot be misread as a project with no galleries.
 */
export const NothingStaged: Story = { args: { model: emptyModel } };

/**
 * On a phone: the nav is a drawer and the two columns are tabs.
 *
 * The tab pair is the same gesture `HistorySplit` uses, and both panes stay
 * mounted so switching sides does not lose scroll position.
 */
export const Mobile: Story = { args: { layout: "mobile" } };

/** The phone form in light mode. */
export const MobileLight: Story = {
  args: { layout: "mobile" },
  globals: { theme: "light" },
};

/**
 * The same publish with the chrome cut back — the density proposal, for
 * comparison against `Default`.
 *
 * Three things are gone from every screen, and the research each came from is
 * on the component that implements it:
 *
 * 1. **The author filter band.** Now a menu on the nav, where GitHub's
 *    Files-changed tree puts the equivalent "owned by you or your team" filter.
 *    Whose changes you are looking at narrows the LIST, so it belongs on the
 *    list. See `CompareAuthorFilterMenu`.
 * 2. **Per-row avatars, unless you hover.** Google Docs shows a suggestion's
 *    author on hover rather than beside every one. The demotion is suspended
 *    for rows an undo has pulled in, which is the one case where authorship is
 *    a consequence rather than a curiosity. See `RowAuthors`.
 * 3. **The checkbox column and the counting bar.** Replaced by a per-row hover
 *    action confirmed in place — Sanity's Review Changes model. See
 *    `RowQuickUndo`.
 *
 * Read this story against `Default` rather than on its own. The question is not
 * whether it is calmer — it is — but whether anything you needed went with the
 * noise.
 */
export const ReducedChrome: Story = { args: { density: "reduced" } };

/** Reduced chrome in light mode. */
export const ReducedChromeLight: Story = {
  args: { density: "reduced" },
  globals: { theme: "light" },
};

/**
 * Reduced chrome, in undo mode, where the per-row action replaces the column.
 *
 * `undoPicks: []` enters the mode. In this density that no longer means a bar
 * and eleven checkboxes; it means each row offers its own action on hover, and
 * the dependency consequence is stated in the confirmation rather than counted
 * continuously in a bar.
 *
 * The cost is visible here too: undoing four related changes is four hovers and
 * four confirmations, where the selection model did it in one click on a group
 * heading.
 */
export const ReducedChromeUndo: Story = {
  args: { density: "reduced", undoPicks: [] },
};

/**
 * The author filter where it now lives.
 *
 * Open the menu at the top of the nav. What the band did for free — "who else
 * is publishing right now", answered with no interaction — is reduced to the
 * count on the trigger. That is the trade, and it is the part to disagree with
 * if you are going to.
 */
export const ReducedChromeAuthorMenu: Story = {
  args: { density: "reduced" },
};

/** The reduced form on a phone, where the saved bands matter most. */
export const ReducedChromeMobile: Story = {
  args: { density: "reduced", layout: "mobile" },
};
