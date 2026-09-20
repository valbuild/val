import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { fn } from "storybook/test";
import {
  ExternalPagesDialog,
  ExternalPagesSelectionMode,
} from "../ExternalPagesDialog";
import { useValPortal } from "../../ValPortalProvider";
import { mockExternalPages } from "../mockShellData";

/**
 * Four answers to one question: how do you pick which URLs to check?
 *
 * Selection scopes exactly one action. Nothing else in this dialog acts on a
 * set of rows — there is no bulk edit and no bulk delete — so every checkbox
 * on screen is there for Check and nothing else. On the eighteen URLs below
 * that is **27 checkboxes** (18 rows, 8 domain headers, 1 select-all), every
 * one of them empty, in a list whose entire content is URLs that need reading.
 *
 * The filter already expresses most of the subsets anyone wants: All, Unused,
 * Flagged, and free text. "Check these three specific ones" is the case
 * selection adds, and the question is what that case is worth.
 *
 * Switch `selection` in the controls to compare. Each story below is one
 * setting, so they can be opened side by side.
 */
const meta: Meta<typeof SelectionHarness> = {
  title: "Shell/ExternalPages Selection",
  component: SelectionHarness,
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
  argTypes: {
    selection: {
      control: "inline-radio",
      options: ["always", "hover", "explicit", "none"],
    },
  },
  args: { selection: "always" },
};
export default meta;

function SelectionHarness({
  selection,
}: {
  selection: ExternalPagesSelectionMode;
}) {
  const portalContainer = useValPortal();
  const [open, setOpen] = useState(true);
  return (
    <div className="w-full h-screen bg-bg-canvas">
      <ExternalPagesDialog
        open={open}
        onOpenChange={setOpen}
        breakpoint="desktop"
        pages={mockExternalPages}
        portalContainer={portalContainer}
        selection={selection}
        onOpenEntry={fn()}
        onOpenUsage={fn()}
        onAddPage={fn()}
      />
    </div>
  );
}

type Story = StoryObj<typeof SelectionHarness>;

/**
 * **What shipped.** 27 checkboxes, all empty, all permanent.
 *
 * The complaint. Scan the left column and count how much of it is chrome
 * rather than content: a checkbox, a status icon and a disclosure chevron
 * stand between the edge of the panel and the first character of every URL.
 */
export const Always: Story = { args: { selection: "always" } };

/**
 * **Hover.** The same 27, painted only under the pointer or under keyboard
 * focus — and all of them once anything is ticked, because a half-visible
 * selection is worse than a visible one.
 *
 * The slot stays reserved, so nothing moves as the pointer crosses a row.
 * Costs nothing in capability: every selection you could make before, you can
 * still make. Costs one thing in discoverability — someone who never hovers a
 * row never learns selection exists, which the select-all in the list header
 * is left visible to answer.
 *
 * Move the pointer down the list to see it.
 */
export const Hover: Story = { args: { selection: "hover" } };

/**
 * **Explicit.** No checkboxes until **Select** is pressed, then all of them.
 *
 * The cleanest default state of the four that keeps ad-hoc selection, and the
 * most honest about selection being a mode you enter for one purpose. The cost
 * is a click before the first tick, every time — and a second state of the
 * toolbar to understand.
 */
export const Explicit: Story = { args: { selection: "explicit" } };

/**
 * **None.** No selection anywhere. Check acts on whatever the filter shows,
 * and the filter is how you scope it.
 *
 * The list becomes what it is about: URLs, their status and their usage. This
 * is the only option that removes the concept rather than hiding it — and the
 * only one that loses something, namely "check exactly these three". Whether
 * that matters is the question: `Flagged` already means "the ones worth
 * re-checking", and `Unused` and the text filter cover most of the rest.
 */
export const None: Story = { args: { selection: "none" } };
