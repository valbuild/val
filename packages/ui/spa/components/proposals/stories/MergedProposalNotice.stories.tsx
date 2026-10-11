import type { Meta, StoryObj } from "@storybook/react";
import { MergedProposalNotice } from "../MergedProposalNotice";

/**
 * Above the editor at a merged proposal's address. A merged proposal is
 * finished (`docs/proposals.md` in valbuild/home), so the Studio there says so
 * before anyone types, and says where to go instead.
 */
const meta: Meta<typeof MergedProposalNotice> = {
  title: "Proposals/Merged",
  component: MergedProposalNotice,
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-6">
        <Story />
      </div>
    ),
  ],
  args: {
    displayName: "Spring campaign",
    continuedIn: null,
    onOpenContinuation: () => {},
    onNewProposal: () => {},
    onGoToSite: () => {},
  },
};
export default meta;
type Story = StoryObj<typeof MergedProposalNotice>;

/** Nothing was written during the merge: a new proposal is the way on. */
export const Finished: Story = {};

/** Changes written during the merge went to a new proposal: carry on there. */
export const ContinuedElsewhere: Story = {
  args: { continuedIn: { displayName: "Spring campaign (2)" } },
};

/** The site's address is not known: no button that cannot work. */
export const WithoutTheSite: Story = {
  args: { onGoToSite: undefined },
};
