import {
  isRecord,
  isoOrNull,
  planFixOf,
  planRefusalCodeOf,
  type PlanFix,
  type PlanRefusalCode,
} from "../../../utils/planRefusal";
import { safeHref } from "../../../utils/safeHref";
import { parsePlanAccess, type PlanAccess } from "./readOnly";

/**
 * Everything `GET /orgs/:org/projects/:project/access` tells the Studio, read
 * defensively.
 *
 * The answer is the organization's `PlanAccess` (a failed payment makes the
 * whole Studio read-only), the project's own `limits` (valbuild/home's
 * `ProjectLimits` in `content/src/billing/projectLimits.ts`: the Free change
 * count, a Hosted trial and month, and what is refused now with what fixes
 * it), and who can fix it: `canFix` (the asker is an owner), the owners by
 * name, Billing and the project's page in Val Build.
 *
 * A Studio is released separately from Val Build and can meet an older or a
 * newer one, so nothing here is all-or-nothing: an unknown plan, code, fix or
 * trial status is kept as `other` (and still said), a missing link is `null`
 * (and offers no button rather than a broken one), and a malformed `limits`
 * is `null` without losing the rest. `fixtures/` holds what the server sends
 * today, generated from its own code.
 */
export type Owner = { name: string; email: string };

export type ProjectPlanName = "free" | "pro" | "hosted" | "sponsored" | "other";

/** The three writes Val Build answers for. */
export type PlanWrite = "edit" | "publish" | "remoteFiles";

export type LimitRefusal = {
  code: PlanRefusalCode;
  rawCode: string;
  fix: PlanFix;
  /** When it lifts by itself (ISO), if it does. */
  until: string | null;
};

export type FreeChanges = {
  used: number;
  limit: number;
  left: number;
  /** At or past the warning (800), with some left. */
  warn: boolean;
  /** When the next change can be saved, once none are left (ISO). */
  nextAt: string | null;
};

export type TrialSummary =
  | {
      status: "running";
      daysLeft: number;
      publishesLeft: number;
      endsAt: string | null;
      /**
       * The fullest meter as a share of what the trial may use, 0–1, when
       * Val Build says. Today it does not (valbuild/home's `TrialSummary`
       * drops it), and `trialUsageShare` reads it off the month instead.
       */
      usageShare: number | null;
    }
  | { status: "running-with-card"; daysLeft: number; endsAt: string | null }
  | {
      status: "over";
      reason: "days" | "usage" | "other";
      endedAt: string | null;
      /** When the site stops serving, unless a card is added first. */
      pauseAt: string | null;
    }
  | { status: "converted" }
  /** A status this Studio does not know: shown as nothing. */
  | { status: "other" };

export type UsageMeter = {
  meter: string;
  used: number;
  included: number;
  /** `used / included`: 1 is all of it. */
  share: number;
};

export type UsageSummary = {
  meters: UsageMeter[];
  /** At or past 80% of what is included, and not yet out. */
  warn: string[];
  out: string[];
  /** When the month's allowance starts again (ISO), the 1st, UTC. */
  resetsAt: string | null;
};

export type ProjectLimits = {
  plan: ProjectPlanName;
  changes: FreeChanges | null;
  refused: Partial<Record<PlanWrite, LimitRefusal>>;
  trial: TrialSummary | null;
  usage: UsageSummary | null;
};

export type StudioAccess = {
  /** The organization's half; null when it could not be read. */
  plan: PlanAccess | null;
  /** The project's own plan; null from a Val Build that does not send it. */
  limits: ProjectLimits | null;
  org: string | null;
  /** The asker is an owner. False when not said: then the owners are asked. */
  canFix: boolean;
  owners: Owner[];
  /** The organization's Billing in Val Build. */
  billingUrl: string | null;
  /** The project's page in Val Build, where a Hosted project's over-usage policy is set. */
  projectUrl: string | null;
};

/**
 * Whether the answer refuses editing: the organization is read-only, or the
 * project's plan refuses the edit write. What decides whether held saves are
 * sent again (`useResumeRefusedSaves`).
 */
export function editRefused(access: StudioAccess): boolean {
  return (
    access.plan?.access === "read-only" ||
    access.limits?.refused.edit !== undefined
  );
}

/** Val Build's trial: 3 publishes, and 10% of a month's included usage. */
export const TRIAL_PUBLISHES = 3;
export const TRIAL_USAGE_SHARE = 0.1;

/** The meters whose running out pauses a Hosted site; the rest stop uploads. */
export const TRAFFIC_METERS: readonly string[] = [
  "siteRequests",
  "renderMs",
  "fileReads",
];
export const STORAGE_METERS: readonly string[] = ["filesStored", "fileUploads"];

const PLANS: readonly ProjectPlanName[] = [
  "free",
  "pro",
  "hosted",
  "sponsored",
];

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/** A link Val Build sent, if it is one we will put in an `href`. */
function linkOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return safeHref(value) ?? null;
}

function parseOwners(value: unknown): Owner[] {
  if (!Array.isArray(value)) return [];
  const owners: Owner[] = [];
  for (const owner of value) {
    if (
      isRecord(owner) &&
      typeof owner.name === "string" &&
      typeof owner.email === "string" &&
      owner.email.includes("@")
    ) {
      owners.push({ name: owner.name || owner.email, email: owner.email });
    }
  }
  return owners;
}

function parseRefusal(value: unknown): LimitRefusal | null {
  if (!isRecord(value) || typeof value.code !== "string") return null;
  return {
    code: planRefusalCodeOf(value.code),
    rawCode: value.code,
    fix: planFixOf(value.fix),
    until: isoOrNull(value.until),
  };
}

function parseChanges(value: unknown): FreeChanges | null {
  if (
    !isRecord(value) ||
    !isNumber(value.used) ||
    !isNumber(value.limit) ||
    !isNumber(value.left)
  ) {
    return null;
  }
  return {
    used: value.used,
    limit: value.limit,
    left: value.left,
    warn: value.warn === true,
    nextAt: isoOrNull(value.nextAt),
  };
}

function parseTrial(value: unknown): TrialSummary | null {
  if (!isRecord(value)) return null;
  switch (value.status) {
    case "running":
      if (!isNumber(value.daysLeft) || !isNumber(value.publishesLeft)) {
        return { status: "other" };
      }
      return {
        status: "running",
        daysLeft: value.daysLeft,
        publishesLeft: value.publishesLeft,
        endsAt: isoOrNull(value.endsAt),
        usageShare: isNumber(value.usageShare) ? value.usageShare : null,
      };
    case "running-with-card":
      if (!isNumber(value.daysLeft)) return { status: "other" };
      return {
        status: "running-with-card",
        daysLeft: value.daysLeft,
        endsAt: isoOrNull(value.endsAt),
      };
    case "over":
      return {
        status: "over",
        reason:
          value.reason === "days" || value.reason === "usage"
            ? value.reason
            : "other",
        endedAt: isoOrNull(value.endedAt),
        pauseAt: isoOrNull(value.pauseAt),
      };
    case "converted":
      return { status: "converted" };
    default:
      return { status: "other" };
  }
}

function parseMeterNames(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((meter): meter is string => typeof meter === "string")
    : [];
}

function parseUsage(value: unknown): UsageSummary | null {
  if (!isRecord(value)) return null;
  const meters: UsageMeter[] = [];
  if (Array.isArray(value.meters)) {
    for (const meter of value.meters) {
      if (
        isRecord(meter) &&
        typeof meter.meter === "string" &&
        isNumber(meter.used) &&
        isNumber(meter.included) &&
        isNumber(meter.share)
      ) {
        meters.push({
          meter: meter.meter,
          used: meter.used,
          included: meter.included,
          share: meter.share,
        });
      }
    }
  }
  return {
    meters,
    warn: parseMeterNames(value.warn),
    out: parseMeterNames(value.out),
    resetsAt: isoOrNull(value.resetsAt),
  };
}

export function parseProjectLimits(value: unknown): ProjectLimits | null {
  if (!isRecord(value)) return null;
  const refused: Partial<Record<PlanWrite, LimitRefusal>> = {};
  if (isRecord(value.refused)) {
    const writes: PlanWrite[] = ["edit", "publish", "remoteFiles"];
    for (const write of writes) {
      const refusal = parseRefusal(value.refused[write]);
      if (refusal !== null) refused[write] = refusal;
    }
  }
  return {
    plan: PLANS.find((plan) => plan === value.plan) ?? "other",
    changes: parseChanges(value.changes),
    refused,
    trial: parseTrial(value.trial),
    usage: parseUsage(value.usage),
  };
}

/** The whole `/access` answer, or null for anything that is not one. */
export function parseStudioAccess(json: unknown): StudioAccess | null {
  if (!isRecord(json)) return null;
  if (json.access !== "edit" && json.access !== "read-only") return null;
  return {
    plan: parsePlanAccess(json),
    limits: parseProjectLimits(json.limits),
    org: stringOrNull(json.org),
    canFix: json.canFix === true,
    owners: parseOwners(json.owners),
    billingUrl: linkOrNull(json.billingUrl),
    projectUrl: linkOrNull(json.projectUrl),
  };
}

/**
 * How much of a running trial's usage is used, 0–1: Val Build's own number
 * when it sends one, else the fullest meter of the month against the trial's
 * tenth of it. The month counts from the trial's start (`monthOf` in
 * valbuild/home), so that is the trial's usage -- until a trial runs over the
 * 1st, when it reads low.
 */
export function trialUsageShare(limits: ProjectLimits): number | null {
  if (limits.trial?.status !== "running") return null;
  if (limits.trial.usageShare !== null) return limits.trial.usageShare;
  if (limits.usage === null || limits.usage.meters.length === 0) return null;
  return Math.max(
    ...limits.usage.meters.map((meter) => meter.share / TRIAL_USAGE_SHARE),
  );
}

/** What `useStudioAccess` needs of `fetch`: tests pass their own. */
export type FetchAnswer = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
