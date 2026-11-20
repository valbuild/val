import type { Meta, StoryObj } from "@storybook/react";
import { SiteUpdateSection } from "../SiteUpdateSection";
import type { UpgradeSettings } from "../../../upgrade/useUpgrade";

/**
 * Settings → Updates: what there is to upgrade in the site's dependencies,
 * and the way to Val Build, where the upgrade is made. Shown in the width of
 * the Settings panel.
 */
const meta: Meta<typeof SiteUpdateSection> = {
  title: "Shell/SettingsPanel/Updates",
  component: SiteUpdateSection,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-[380px] max-w-[calc(100vw-24px)] rounded-lg border border-border-float bg-bg-float pt-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof SiteUpdateSection>;

const settings = (check: UpgradeSettings["check"]): UpgradeSettings => ({
  check,
  onOpen: () => undefined,
  onRecheck: () => undefined,
});

/** Something of every kind: security fixes, minor versions and a full upgrade. */
export const Found: Story = {
  args: {
    upgrade: settings({
      status: "checked",
      at: Date.now(),
      check: {
        state: "checked",
        checkedAt: "2026-11-11T10:00:00Z",
        available: true,
        cves: {
          vulnerable: 2,
          fixable: 3,
          severity: "high",
          packages: [
            { name: "vite", version: "8.1.0", severity: "high" },
            { name: "esbuild", version: "0.27.0", severity: "moderate" },
          ],
        },
        latest: {
          packages: [
            { name: "@valbuild/core", from: "0.152.2", to: "0.153.1" },
            { name: "react", from: "19.2.0", to: "19.3.0" },
            { name: "tailwindcss", from: "4.1.0", to: "4.2.1" },
          ],
          val: { from: "0.152.2", to: "0.153.1" },
        },
        majors: {
          packages: [
            { name: "@tanstack/react-start", from: "1.0.0", to: "2.0.0" },
          ],
        },
      },
    }),
  },
};

/** Nothing to upgrade. */
export const UpToDate: Story = {
  args: {
    upgrade: settings({
      status: "checked",
      at: Date.now(),
      check: {
        state: "checked",
        checkedAt: "2026-11-11T10:00:00Z",
        available: false,
        cves: { vulnerable: 0, fixable: 0, severity: null, packages: [] },
        latest: { packages: [], val: null },
        majors: { packages: [] },
      },
    }),
  },
};

export const Checking: Story = {
  args: { upgrade: settings({ status: "checking" }) },
};

/** The check failed: what Val Build said, and Try again. */
export const CheckFailed: Story = {
  args: {
    upgrade: settings({
      status: "failed",
      message: "Val Build could not be reached.",
    }),
  },
};
