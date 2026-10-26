import type { Meta, StoryObj } from "@storybook/react";
import type { ProposalUpgrade } from "../../../proposals/proposalsClient";
import { UpgradeProposalNotice } from "../UpgradeProposalNotice";

/**
 * Above the editor at an upgrade proposal's address: what it upgrades, that
 * it holds no content changes, and that publishing it updates the site. The
 * checks are in Val Build, linked.
 */
const minor: ProposalUpgrade = {
  path: "latest",
  state: "staged",
  changes: [
    {
      name: "@valbuild/tanstack",
      from: "0.149.4",
      to: "0.149.7",
      kind: "patch",
    },
    { name: "@valbuild/core", from: "0.149.4", to: "0.149.7", kind: "patch" },
    { name: "@valbuild/ui", from: "0.149.4", to: "0.149.7", kind: "patch" },
    {
      name: "@tanstack/react-router",
      from: "1.120.3",
      to: "1.121.0",
      kind: "minor",
    },
    {
      name: "@tanstack/react-start",
      from: "1.120.3",
      to: "1.121.0",
      kind: "minor",
    },
    { name: "vite", from: "7.1.2", to: "7.1.5", kind: "patch" },
  ],
  vulnerableBefore: 0,
  vulnerableAfter: 0,
  error: null,
};

const meta: Meta<typeof UpgradeProposalNotice> = {
  title: "Proposals/Upgrade",
  component: UpgradeProposalNotice,
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-6">
        <Story />
      </div>
    ),
  ],
  args: {
    upgrade: minor,
    siteName: "quiet-harbor-24",
    onPublish: () => {},
    checksHref: "#val-build",
  },
};
export default meta;
type Story = StoryObj<typeof UpgradeProposalNotice>;

/** Checked in Val Build: look around, then publish to update the site. */
export const Ready: Story = {};

/** Security fixes, said as such, with how many. */
export const SecurityFixes: Story = {
  args: {
    upgrade: {
      ...minor,
      path: "cves",
      changes: [{ name: "vite", from: "7.1.2", to: "7.1.5", kind: "patch" }],
      vulnerableBefore: 2,
      vulnerableAfter: 0,
    },
  },
};

/** A major version: marked on its package. */
export const Major: Story = {
  args: {
    upgrade: {
      ...minor,
      path: "majors",
      changes: [
        {
          name: "@valbuild/tanstack",
          from: "0.149.4",
          to: "1.0.0",
          kind: "major",
        },
        ...minor.changes.slice(1),
      ],
    },
  },
};

/** Still being worked out in Val Build: nothing to publish yet. */
export const Computing: Story = {
  args: { upgrade: { ...minor, state: "computing", changes: [] } },
};

/** It could not be worked out: what went wrong, and where to see more. */
export const Failed: Story = {
  args: {
    upgrade: {
      ...minor,
      state: "failed",
      changes: [],
      error:
        "No version of @tanstack/react-start fits @valbuild/tanstack 0.149.7.",
    },
  },
};
