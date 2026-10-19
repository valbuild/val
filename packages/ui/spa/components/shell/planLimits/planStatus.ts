import {
  fixAction,
  formatCount,
  formatShare,
  plural,
  projectNames,
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
 * The notices' own button (`fixAction`), with "Ask an owner" for anyone
 * else: shorter than a notice's "Ask them to add a card", because the bar
 * has room for two words.
 */
function statusAction(
  access: StudioAccess,
  fix: "add-card" | "upgrade",
  subject: string,
  why: string,
): PlanAction | null {
  return fixAction(
    viewerOf(access, null),
    fix,
    { subject, why },
    { ask: "Ask an owner" },
  );
}

export function planStatusOf(
  access: StudioAccess | null,
  /** The project's own name (`website`), or null when it is not known. */
  project: string | null,
): PlanStatus | null {
  const limits = access?.limits ?? null;
  const named = projectNames(project);
  // Mail text, read by a person: the locale only changes digit grouping.
  const en = { locale: "en-US" };
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
        `${named.start}: please add a card before the trial ends`,
        `${named.start} is on a trial with ${plural(trial.daysLeft, "day", "days", en)} left. Adding a card keeps it going after that, and lifts the trial's limits.`,
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
        `${named.start}: please upgrade to Pro`,
        `${named.start} is on the Free plan, which allows ${plural(changes.limit, "change", "changes", en)} in 7 days, and has ${formatCount(changes.left, en)} left this week. Pro has no limit.`,
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
  const days = (n: number) => `${plural(n, "day", "days", format)} left`;
  switch (status.kind) {
    case "trial":
      return [
        days(status.daysLeft),
        `${formatCount(status.publishesUsed, format)} of ${plural(status.publishesTotal, "publish", "publishes", format)}`,
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
          : `${plural(status.left, "change", "changes", format)} left this week`,
        "publishing is never limited",
      ];
  }
}
