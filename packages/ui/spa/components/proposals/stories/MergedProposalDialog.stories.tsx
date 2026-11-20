import type { Meta, StoryObj } from "@storybook/react";
import { MergedProposalDialog } from "../MergedProposalDialog";

/**
 * At a merged proposal's address. A merged proposal is finished
 * (`docs/proposals.md` in valbuild/home): there is nothing more to do in it,
 * so the Studio there says so in a dialog that does not close onto it, and
 * offers only the ways out.
 */
const meta: Meta<typeof MergedProposalDialog> = {
  title: "Proposals/Merged",
  component: MergedProposalDialog,
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
  args: {
    open: true,
    displayName: "Spring campaign",
    continuedIn: null,
    onOpenContinuation: () => {},
    onNewProposal: () => {},
    onShowAllProposals: () => {},
    onGoToSite: () => {},
  },
};
export default meta;
type Story = StoryObj<typeof MergedProposalDialog>;

/** Nothing was written during the merge: back to the site is the way on. */
export const Finished: Story = {};

/** Changes written during the merge went to a new proposal: carry on there. */
export const ContinuedElsewhere: Story = {
  args: { continuedIn: { displayName: "Spring campaign (2)" } },
};

/** The site's address is not known: no button that cannot work. */
export const WithoutTheSite: Story = {
  args: { onGoToSite: undefined },
};
