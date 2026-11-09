import type { Meta, StoryObj } from "@storybook/react";
import { CommitMessageDialog } from "../CommitMessageDialog";

/**
 * The commit message, where the project asks for one on every commit
 * (`studio.commitMessage: "required"`): before Commit, and before Publish,
 * which commits first in a project connected to git. Press Commit with the
 * field empty to see it marked.
 */
const meta: Meta<typeof CommitMessageDialog> = {
  title: "Proposals/Commit message",
  component: CommitMessageDialog,
  parameters: { layout: "fullscreen", backgrounds: { disable: true } },
  args: {
    open: true,
    onOpenChange: () => {},
    purpose: "commit",
    branch: "val/p/a1b2c3d4e5f6a7b8c9d0",
    onCommit: () => {},
  },
};
export default meta;
type Story = StoryObj<typeof CommitMessageDialog>;

export const Commit: Story = {};

/** Before Publish: the commit it makes before merging. */
export const BeforePublish: Story = { args: { purpose: "publish" } };
