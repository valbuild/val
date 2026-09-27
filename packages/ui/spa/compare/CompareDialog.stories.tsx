import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { CompareDialog } from "./CompareDialog";
import {
  commitBasisModel,
  compareModel,
  deepDataModel,
  emptyModel,
  longCommitMessageModel,
  previewedModel,
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
  undoMode,
  tone,
}: {
  model: CompareModel;
  layout?: "desktop" | "mobile";
  authorFilter?: string | null;
  undoMode?: boolean;
  tone?: "alarm" | "calm";
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
        initialUndoMode={undoMode}
        tone={tone}
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
 * Undo mode.
 *
 * Entered from the header rather than always on: this is a reading surface, and
 * the old review screen's problem was mixing reading with discarding. There is
 * no checkbox column and no running count — each row carries its own action on
 * hover, confirmed in place, which is how Sanity's Review Changes and Google
 * Docs' suggestion mode both do it.
 *
 * Hover a row on the right to see the action; the bar carries only the mode,
 * the way out, and "Discard all" for the other extreme.
 */
export const UndoMode: Story = { args: { undoMode: true } };

/**
 * What a single undo drags along, said before the click.
 *
 * `brand` compels two later changes by the prefix invariant — a later patch's
 * indices were computed against a state in which its predecessors applied — and
 * one of them is somebody else's. Hover the `brand` row and open its action:
 * the confirmation names the count AND the person, which is the whole reason
 * this dialog computes a closure at all.
 *
 * This replaced a bar that counted the same thing continuously across an
 * arbitrary selection. The truth did not change; only where it is said.
 */
export const UndoPullsInDependents: Story = { args: { undoMode: true } };

/**
 * Reverting to a commit, where the schema is the question.
 *
 * All three of `checkCompatibility`'s answers on one screen: `heading` is fine,
 * `intro` is rich text and therefore `unknown` — offered anyway, because this
 * gate cannot see the value and the real check runs at confirm — and `cta`
 * became a union with no variant of the old shape, so it is refused with the
 * reason where its action would be.
 *
 * The bar also carries `revertAll`, which exists because "a publish went wrong
 * and they want it undone, all of it, now" is the case people actually have.
 */
export const RevertToCommit: Story = {
  args: { model: revertBasisModel, undoMode: true },
};

/** Undo mode on a phone. */
export const UndoModeMobile: Story = {
  args: { undoMode: true, layout: "mobile" },
};

/**
 * The author filter, which lives on the nav rather than in a band of its own.
 *
 * Open the menu at the top of the nav. GitHub's Files-changed tree puts the
 * equivalent "owned by you or your team" filter on the tree for the same
 * reason: whose changes you are looking at narrows the LIST, not the
 * comparison.
 *
 * What a permanent band did for free — "who else is publishing right now",
 * answered with no interaction — is reduced to the count on the trigger.
 */
export const AuthorMenu: Story = {};

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
 * The same mode in the louder tone, for comparison.
 *
 * `alarm` paints the bulk action red whatever the mode is doing. `calm` — the
 * default — reserves red for the one action that destroys something: reverting
 * a staged change, confirmed on a single row. See `UndoTone`.
 *
 * Read this against `UndoMode`. The question is not which is prettier but
 * whether the red is telling the truth: the bulk button here reverts every
 * staged change in the publish, which IS the most destructive thing on the
 * screen, so there is a real case for it.
 */
export const UndoModeAlarmTone: Story = {
  args: { undoMode: true, tone: "alarm" },
};

/**
 * Restoring from a commit, in the calm tone.
 *
 * Nothing here is destructive and the words say so: "Restore", not "Revert",
 * because the change already shipped and what this does is bring an old value
 * back as a NEW staged change — reviewable, publishable, and revertable in
 * turn. The bar says that under the hint.
 */
export const RestoreFromCommit: Story = {
  args: { model: revertBasisModel, undoMode: true },
};

/** The same restore in the louder tone, where the bulk action goes solid. */
export const RestoreFromCommitAlarmTone: Story = {
  args: { model: revertBasisModel, undoMode: true, tone: "alarm" },
};

/**
 * Nothing in this publish declares `.preview(...)`.
 *
 * The baseline, and the case that has to keep working: an un-annotated project
 * reads exactly as it did before previews existed. Every row is its key, every
 * heading is its path, and `describePath` says `origin.title === "fallback"` for
 * all of them — which is what stops the view drawing a second line that would
 * only repeat the first.
 *
 * Open `authors.val.ts` and read it against `WithPreviews`.
 */
export const WithoutPreviews: Story = {};

/**
 * The same publish, where the schemas name their values.
 *
 * `authors.val.ts` is the one to open. Three things to check, in order of how
 * easy they would be to get wrong:
 *
 * - **The key survives.** "Kim Midtlid" has `kimmid` beside it in mono. Dropping
 *   it would read better and would break matching an entry to its other side,
 *   grepping, and telling two people with the same name apart.
 * - **`erlamd` is unnamed, in a record where its neighbours are named.** A
 *   removed entry's preview must be computed from the before side; an adapter
 *   that forgets produces exactly this row, and it stays readable.
 * - **The nav did not change.** Compare the left rail against `WithoutPreviews`:
 *   identical. It is a location, so it carries routes and keys — see the rule
 *   in `core/src/preview.ts` and the header of `CompareNav`.
 *
 * Then open the renamed page under `blogs`: the title says what the page is,
 * and the `from → to` routes still say what happened to it.
 */
export const WithPreviews: Story = { args: { model: previewedModel } };

/** The previewed publish in light mode. */
export const WithPreviewsLight: Story = {
  args: { model: previewedModel },
  globals: { theme: "light" },
};

/**
 * A previewed publish on a phone, where the key and the name compete for width.
 *
 * The name is capped at 45% of the head so the key is never squeezed out
 * entirely — on a narrow screen the truncated key is still the thing that tells
 * two rows apart.
 */
export const WithPreviewsMobile: Story = {
  args: { model: previewedModel, layout: "mobile" },
};

/**
 * A structured project, where compact folders earn their place.
 *
 * `/content/shop/shipping/rates.val.ts` and its neighbour would otherwise be
 * four rows of folders with one child each. The row reading `shop / shipping`
 * still selects `/content/shop/shipping` — the deepest directory it names, not
 * the outermost.
 *
 * The limits are on screen too: `editorial` has a single child and does NOT
 * merge, because that child is a file and `editorial / authors` would read as a
 * path to a directory called `authors`. `content` has three children, so it
 * does not merge either.
 */
export const DeepDataTree: Story = { args: { model: deepDataModel } };
