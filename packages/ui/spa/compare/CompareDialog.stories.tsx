import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { CompareDialog } from "./CompareDialog";
import {
  commitBasisModel,
  compareModel,
  emptyModel,
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
}: {
  model: CompareModel;
  layout?: "desktop" | "mobile";
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
 * Comparing against a commit instead of against published.
 *
 * Only the side labels differ, which is the whole claim the basis dropdown
 * makes: one compare surface, reachable from Publish and from History.
 */
export const AgainstACommit: Story = { args: { model: commitBasisModel } };

/**
 * One module, three fields, two of them unchanged.
 *
 * The case for the "Show all fields" toggle: with changed-only on, this pane is
 * a single row, and the toggle in the toolbar says how much it is hiding.
 */
export const ShowAllFields: Story = { args: { model: singleModuleModel } };

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
