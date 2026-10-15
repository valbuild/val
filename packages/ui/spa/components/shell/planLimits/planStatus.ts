import {
  fixAction,
  formatCount,
  formatShare,
  mailOwners,
  viewerOf,
  type PlanAction,
  type PlanFormat,
} from "./planCopy";
import {
  TRIAL_PUBLISHES,
  trialUsageShare,
  type StudioAccess,
} from "./studioAccess";

/**
 * The plan, said in the top bar while nothing is refused yet but something is
 * running out: a Hosted trial's days, publishes and usage, and a Free
 * project's changes from the warning on. Nothing at all for Pro, Sponsored, a
 * trial that converted, or Free below the warning -- a plan with nothing to
 * say does not get a badge.
 */
export type PlanStatus =
  | {
      kind: "trial";
      daysLeft: number;
      publishesUsed: number;
      publishesTotal: number;
      /** 0–1, or null when Val Build sent nothing to read it from. */
      usageShare: number | null;
      action: PlanAction | null;
    }
  | {
      kind: "trial-with-card";
      daysLeft: number;
      endsAt: string | null;
    }
  | {
      kind: "free";
      left: number;
      action: PlanAction | null;
    };

/**
 * "Ask an owner", for the top bar: shorter than a notice's "Ask them to add
 * a card", because the bar has room for two words.
 */
function statusAction(
  access: StudioAccess,
  fix: "add-card" | "upgrade",
  subject: string,
  why: string,
): PlanAction | null {
  const viewer = viewerOf(access, null);
  if (viewer.canFix === false) {
    if (viewer.owners.length === 0) return null;
    const where = viewer.billingUrl;
    return {
      label: "Ask an owner",
      href: mailOwners(
        viewer,
        subject,
        `${why}\n\nCould you ${fix === "add-card" ? "add a card" : "upgrade to Pro"}?` +
          (where !== null ? ` It is done here: ${where}` : ""),
      ),
      external: false,
    };
  }
  return fixAction(viewer, fix, { subject, why });
}

export function planStatusOf(
  access: StudioAccess | null,
  project: string,
): PlanStatus | null {
  const limits = access?.limits ?? null;
  if (access === null || limits === null) return null;
  const trial = limits.trial;
  if (limits.plan === "hosted" && trial?.status === "running") {
    return {
      kind: "trial",
      daysLeft: trial.daysLeft,
      publishesUsed: Math.min(
        Math.max(TRIAL_PUBLISHES - trial.publishesLeft, 0),
        TRIAL_PUBLISHES,
      ),
      publishesTotal: TRIAL_PUBLISHES,
      usageShare: trialUsageShare(limits),
      action: statusAction(
        access,
        "add-card",
        `${project}'s trial: please add a card`,
        `${project} is on a trial with ${trial.daysLeft} days left. Adding a card keeps it going after that, and lifts the trial's limits.`,
      ),
    };
  }
  if (limits.plan === "hosted" && trial?.status === "running-with-card") {
    return {
      kind: "trial-with-card",
      daysLeft: trial.daysLeft,
      endsAt: trial.endsAt,
    };
  }
  const changes = limits.changes;
  if (
    limits.plan === "free" &&
    changes !== null &&
    (changes.warn || changes.left === 0)
  ) {
    return {
      kind: "free",
      left: changes.left,
      action: statusAction(
        access,
        "upgrade",
        `${project}: please upgrade to Pro`,
        `${project} is on the Free plan, which allows ${changes.limit} changes in 7 days, and has ${changes.left} left this week. Pro has no limit.`,
      ),
    };
  }
  return null;
}

/** The status's words, apart from its badge and button. */
export function planStatusParts(
  status: PlanStatus,
  format: Pick<PlanFormat, "locale">,
): string[] {
  const days = (n: number) =>
    `${formatCount(n, format)} ${n === 1 ? "day" : "days"} left`;
  switch (status.kind) {
    case "trial":
      return [
        days(status.daysLeft),
        `${status.publishesUsed} of ${status.publishesTotal} publishes`,
        ...(status.usageShare === null
          ? []
          : [`${formatShare(status.usageShare, format)} of trial usage`]),
      ];
    case "trial-with-card":
      return [days(status.daysLeft), "card added"];
    case "free":
      return [
        status.left === 0
          ? "No changes left this week"
          : `${formatCount(status.left, format)} ${status.left === 1 ? "change" : "changes"} left this week`,
        "publishing is never limited",
      ];
  }
}
