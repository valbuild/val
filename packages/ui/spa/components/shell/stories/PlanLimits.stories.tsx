import type { Meta, StoryObj } from "@storybook/react";
import { PlanNoticeCard } from "../planLimits/PlanNoticeCard";
import { PlanStatusBar } from "../planLimits/PlanStatusBar";
import { planNoticesOf } from "../planLimits/planNotices";
import { planStatusOf } from "../planLimits/planStatus";
import {
  PLAN_FIXTURES_NOW,
  PLAN_SCENARIOS,
  planScenario,
  type PlanScenario,
} from "../planLimits/fixtures/planScenarios";

/**
 * What the Studio says about a project's plan, for one state and one viewer:
 * the status in the top bar (and above the editor below a desktop), and the
 * notice above the editor. Driven by the answers Val Build really sends
 * (`planLimits/fixtures`). An owner gets the fix; anyone else, the owners by
 * name and a way to ask them.
 *
 * The whole shell around them is in Shell/Shell's Plan stories.
 */
function PlanLimitsPreview({
  scenario,
  viewer,
}: {
  scenario: PlanScenario;
  viewer: "owner" | "editor";
}) {
  const { access, refusal } = planScenario(scenario, viewer);
  const notices = planNoticesOf(access, refusal, {
    project: "website",
    now: PLAN_FIXTURES_NOW,
    changesWaiting: 4,
  });
  const status = planStatusOf(access, "website");
  return (
    <div className="flex max-w-xl flex-col gap-6 bg-bg-primary p-6 text-fg-primary">
      <section className="flex flex-col gap-2">
        <p className="text-xs text-fg-secondary">Top bar</p>
        <div className="flex h-11 items-center rounded-lg border border-border-float bg-bg-float px-3">
          {status === null ? (
            <span className="text-xs text-fg-secondary">Nothing to say</span>
          ) : (
            <PlanStatusBar status={status} placement="top-bar" />
          )}
        </div>
        {status !== null && (
          <PlanStatusBar status={status} placement="column" />
        )}
      </section>
      <section className="flex flex-col gap-2">
        <p className="text-xs text-fg-secondary">
          Above the editor (one at a time, in this order)
        </p>
        {notices.length === 0 ? (
          <span className="text-xs text-fg-secondary">Nothing to say</span>
        ) : (
          notices.map((notice) => (
            <PlanNoticeCard
              key={notice.id}
              notice={notice}
              onDismiss={() => console.log("dismiss", notice.id)}
            />
          ))
        )}
      </section>
    </div>
  );
}

const meta: Meta<typeof PlanLimitsPreview> = {
  title: "Shell/Plan limits",
  component: PlanLimitsPreview,
  argTypes: {
    scenario: {
      control: "select",
      options: Object.keys(PLAN_SCENARIOS),
    },
    viewer: { control: "inline-radio", options: ["owner", "editor"] },
  },
};
export default meta;

type Story = StoryObj<typeof PlanLimitsPreview>;

/** A Hosted trial: days left, publishes used of 3, the trial's usage. */
export const TrialForAnOwner: Story = {
  args: { scenario: "hosted-trial", viewer: "owner" },
};
export const TrialForAnEditor: Story = {
  args: { scenario: "hosted-trial", viewer: "editor" },
};

/** A trial with a card on file: the days, and nothing to do. */
export const TrialWithACard: Story = {
  args: { scenario: "hosted-trial-with-card", viewer: "owner" },
};

/** The trial's 3 publishes are used: keep editing, add a card to publish. */
export const TrialPublishesUsedForAnOwner: Story = {
  args: { scenario: "hosted-trial-publishes-used", viewer: "owner" },
};
export const TrialPublishesUsedForAnEditor: Story = {
  args: { scenario: "hosted-trial-publishes-used", viewer: "editor" },
};

/** The trial ended: the Studio is read-only; the site runs until it pauses. */
export const TrialOverForAnOwner: Story = {
  args: { scenario: "hosted-trial-over", viewer: "owner" },
};
export const TrialOverForAnEditor: Story = {
  args: { scenario: "hosted-trial-over", viewer: "editor" },
};

/** Past 80% of a month's site requests: allow extra usage. */
export const UsageWarningForAnOwner: Story = {
  args: { scenario: "hosted-usage-warn", viewer: "owner" },
};
export const UsageWarningForAnEditor: Story = {
  args: { scenario: "hosted-usage-warn", viewer: "editor" },
};

/** A month's included traffic used up, and the warning behind it. */
export const UsageOutForAnOwner: Story = {
  args: { scenario: "hosted-usage-out", viewer: "owner" },
};
export const UsageOutForAnEditor: Story = {
  args: { scenario: "hosted-usage-out", viewer: "editor" },
};

/** An upload refused: the month's storage is used up. */
export const StorageUsedUpForAnOwner: Story = {
  args: { scenario: "hosted-storage-used-up", viewer: "owner" },
};
export const StorageUsedUpForAnEditor: Story = {
  args: { scenario: "hosted-storage-used-up", viewer: "editor" },
};

/** Free, from 800 changes in 7 days: the changes left, in the top bar. */
export const FreeWarningForAnOwner: Story = {
  args: { scenario: "free-warn", viewer: "owner" },
};
export const FreeWarningForAnEditor: Story = {
  args: { scenario: "free-warn", viewer: "editor" },
};

/** Free at 1,000 changes: when editing opens again, and Upgrade to Pro. */
export const FreeAtLimitForAnOwner: Story = {
  args: { scenario: "free-at-limit", viewer: "owner" },
};
export const FreeAtLimitForAnEditor: Story = {
  args: { scenario: "free-at-limit", viewer: "editor" },
};

/** A remote upload on Free, refused: remote files are part of Pro. */
export const FreeRemoteFilesForAnOwner: Story = {
  args: { scenario: "free-remote-files", viewer: "owner" },
};
export const FreeRemoteFilesForAnEditor: Story = {
  args: { scenario: "free-remote-files", viewer: "editor" },
};

/** A failed payment: the organization's read-only notice, first of all. */
export const PaymentFailedForAnOwner: Story = {
  args: { scenario: "payment-failed", viewer: "owner" },
};
export const PaymentFailedForAnEditor: Story = {
  args: { scenario: "payment-failed", viewer: "editor" },
};
