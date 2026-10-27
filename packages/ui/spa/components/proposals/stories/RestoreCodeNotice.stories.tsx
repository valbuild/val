import type { Meta, StoryObj } from "@storybook/react";
import { RestoreCodeNotice } from "../RestoreCodeNotice";

/**
 * Above the editor in the proposal a "Go back to this point" opened: the code
 * of that point is brought back there when the Studio loads (valbuild/home
 * `docs/hosted-publishing.md`, step 9).
 */
const meta: Meta<typeof RestoreCodeNotice> = {
  title: "Proposals/Restore code",
  component: RestoreCodeNotice,
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-6">
        <Story />
      </div>
    ),
  ],
  args: {
    onRetry: () => {},
    onDismiss: () => {},
  },
};
export default meta;
type Story = StoryObj<typeof RestoreCodeNotice>;

const COMMIT =
  "9274952578522af292d007c10423cad6a2ea5e2eb78865719f6c63c669a71b91";

/** Staging the files and serving the build the site served then. */
export const Restoring: Story = {
  args: { state: { kind: "restoring", commit: COMMIT } },
};

/** Done: the content is in the unsaved changes, so Save is the next step. */
export const Restored: Story = {
  args: { state: { kind: "restored", commit: COMMIT } },
};

/** It could not: Try again asks once more, and the content stays either way. */
export const Failed: Story = {
  args: {
    state: {
      kind: "failed",
      commit: COMMIT,
      message:
        "The code at that point cannot be read: the build's artifacts are gone.",
    },
  },
};
