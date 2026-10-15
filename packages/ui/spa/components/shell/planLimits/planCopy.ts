import type { PlanFix } from "../../../utils/planRefusal";
import { names } from "./readOnly";
import type { Owner, StudioAccess } from "./studioAccess";

/**
 * The words and links every plan notice and status shares: who can fix it,
 * the button they get, and the times and numbers in the viewer's own locale.
 */

/** A link, in the Studio's notice and status. */
export type PlanAction = { label: string; href: string; external: boolean };

/**
 * Who is looking, as far as the notices need it. `canFix` is null when
 * nothing said -- a refusal that arrived before `/access` answered -- and the
 * owner's action is offered then: it leads to Val Build, which knows.
 */
export type Viewer = {
  org: string | null;
  canFix: boolean | null;
  owners: Owner[];
  billingUrl: string | null;
  projectUrl: string | null;
};

export function viewerOf(
  access: StudioAccess | null,
  fallbackBillingUrl: string | null,
): Viewer {
  if (access === null) {
    return {
      org: null,
      canFix: null,
      owners: [],
      billingUrl: fallbackBillingUrl,
      projectUrl: null,
    };
  }
  return {
    org: access.org,
    canFix: access.canFix,
    owners: access.owners,
    billingUrl: access.billingUrl ?? fallbackBillingUrl,
    projectUrl: access.projectUrl,
  };
}

/** How dates and numbers are said: the viewer's own, unless a test pins them. */
export type PlanFormat = {
  now: Date;
  locale?: string;
  timeZone?: string;
};

const DAY = 86_400_000;

const OWNER_LABEL: Record<PlanFix, string> = {
  upgrade: "Upgrade to Pro",
  "add-card": "Add a card",
  "update-payment": "Update payment",
  "allow-usage": "Allow extra usage",
  other: "Open Billing",
};

/** What an owner would do, after "can" or "to". */
const FIX_VERB: Record<PlanFix, string> = {
  upgrade: "upgrade to Pro",
  "add-card": "add a card",
  "update-payment": "update the payment",
  "allow-usage": "allow extra usage",
  other: "change that",
};

/**
 * The owner's own button. Billing for most fixes; the project's page for
 * extra usage, which is set per project there. With neither link, the
 * project's page (where the owners are listed) or no button at all: a button
 * that leads nowhere is worse than none.
 */
function ownerAction(
  viewer: Viewer,
  fix: PlanFix,
  label: string | undefined,
): PlanAction | null {
  const href =
    fix === "allow-usage"
      ? (viewer.projectUrl ?? viewer.billingUrl)
      : viewer.billingUrl;
  if (href !== null) {
    return { label: label ?? OWNER_LABEL[fix], href, external: true };
  }
  if (viewer.projectUrl !== null) {
    return {
      label: "Open in Val Build",
      href: viewer.projectUrl,
      external: true,
    };
  }
  return null;
}

/** The owners, as a mailto with what to do and where. */
function mailOwners(viewer: Viewer, subject: string, body: string): string {
  const to = viewer.owners.map((owner) => owner.email).join(",");
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Someone who cannot fix it is told who can, and offered to write to them.
 * There is no request to send from the Studio, so it is an email, with the
 * page the owner needs in it.
 */
function askAction(
  viewer: Viewer,
  fix: PlanFix,
  subject: string,
  why: string,
  label: string | undefined,
): PlanAction | null {
  if (viewer.owners.length === 0) {
    // Val Build lists the owners on the project's page.
    const href = viewer.projectUrl ?? viewer.billingUrl;
    return href === null
      ? null
      : { label: "Open in Val Build", href, external: true };
  }
  const where =
    fix === "allow-usage"
      ? (viewer.projectUrl ?? viewer.billingUrl)
      : viewer.billingUrl;
  const one = viewer.owners.length === 1 ? viewer.owners[0] : undefined;
  return {
    label:
      label ??
      (fix === "other"
        ? one !== undefined
          ? `Email ${one.name}`
          : "Email the owners"
        : `Ask ${one !== undefined ? one.name : "them"} to ${FIX_VERB[fix]}`),
    href: mailOwners(
      viewer,
      subject,
      `${why}\n\nCould you ${FIX_VERB[fix]}?` +
        (where !== null ? ` It is done here: ${where}` : ""),
    ),
    external: false,
  };
}

/** The button for this viewer: the fix for an owner, the owners for anyone else. */
export function fixAction(
  viewer: Viewer,
  fix: PlanFix,
  ask: { subject: string; why: string },
  labels: { owner?: string; ask?: string } = {},
): PlanAction | null {
  return viewer.canFix === false
    ? askAction(viewer, fix, ask.subject, ask.why, labels.ask)
    : ownerAction(viewer, fix, labels.owner);
}

/** "Only an owner of acme can add a card: Ada Lovelace and Ole Nordmann." */
export function whoCanFix(viewer: Viewer, fix: PlanFix): string {
  if (viewer.canFix !== false) return "";
  const of = viewer.org === null ? "" : ` of ${viewer.org}`;
  return viewer.owners.length === 0
    ? ` Only an owner${of} can ${FIX_VERB[fix]}.`
    : ` Only an owner${of} can ${FIX_VERB[fix]}: ${names(viewer.owners)}.`;
}

export function formatCount(
  value: number,
  format: Pick<PlanFormat, "locale">,
): string {
  return new Intl.NumberFormat(format.locale).format(value);
}

/** "1 day", "12 days", "1,000 changes": a count and its noun, agreeing. */
export function plural(
  count: number,
  one: string,
  many: string,
  format: Pick<PlanFormat, "locale">,
): string {
  return `${formatCount(count, format)} ${count === 1 ? one : many}`;
}

/**
 * The project's name, for a sentence: as it is when the Studio knows it
 * (`website` stays lower case, as it is typed everywhere else), and "this
 * project" when it does not -- capitalised only where it starts a sentence.
 */
export function projectNames(project: string | null): {
  start: string;
  mid: string;
} {
  return project === null || project === ""
    ? { start: "This project", mid: "this project" }
    : { start: project, mid: project };
}

export function formatShare(
  share: number,
  format: Pick<PlanFormat, "locale">,
): string {
  return new Intl.NumberFormat(format.locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(share);
}

/** "22 October", in the viewer's time zone. */
export function formatDay(iso: string, format: PlanFormat): string {
  return new Intl.DateTimeFormat(format.locale, {
    day: "numeric",
    month: "long",
    timeZone: format.timeZone,
  }).format(new Date(iso));
}

function dayKey(date: Date, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(date);
}

/**
 * "today at 14:20", "tomorrow at 09:05", "on Thursday at 14:20": a moment
 * within the week, in the viewer's time zone. Further out it names the date;
 * a moment already past is "in a moment".
 */
export function formatWhen(iso: string, format: PlanFormat): string {
  const date = new Date(iso);
  /*
   * Already past: Val Build is asked again at that moment (`useStudioAccess`
   * schedules it), so the notice is about to change. Until it does, a day of
   * the week that has gone by would be a promise that cannot be kept.
   */
  if (date.getTime() <= format.now.getTime()) return "in a moment";
  const time = new Intl.DateTimeFormat(format.locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: format.timeZone,
  }).format(date);
  const day = dayKey(date, format.timeZone);
  if (day === dayKey(format.now, format.timeZone)) return `today at ${time}`;
  if (day === dayKey(new Date(format.now.getTime() + DAY), format.timeZone)) {
    return `tomorrow at ${time}`;
  }
  if (date.getTime() - format.now.getTime() < 6 * DAY) {
    const weekday = new Intl.DateTimeFormat(format.locale, {
      weekday: "long",
      timeZone: format.timeZone,
    }).format(date);
    return `on ${weekday} at ${time}`;
  }
  return `on ${formatDay(iso, format)} at ${time}`;
}

/**
 * The month a Hosted allowance belongs to, and the day it starts again,
 * from `resetsAt` (00:00 UTC on the 1st). Said in UTC: a month's allowance is
 * a calendar month, and "1 November" is what the bill says too.
 */
export function usageMonth(
  resetsAt: string | null,
  format: PlanFormat,
): { month: string; resetDay: string } | null {
  if (resetsAt === null) return null;
  const resets = new Date(resetsAt);
  return {
    month: new Intl.DateTimeFormat(format.locale, {
      month: "long",
      timeZone: "UTC",
    }).format(new Date(resets.getTime() - DAY)),
    resetDay: new Intl.DateTimeFormat(format.locale, {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(resets),
  };
}

const METER_NAMES: Record<string, string> = {
  siteRequests: "site requests",
  renderMs: "rendering time",
  fileReads: "file downloads",
  filesStored: "file storage",
  fileUploads: "file uploads",
};

/** A Hosted meter, as a reader names it. */
export function meterName(meter: string): string {
  return METER_NAMES[meter] ?? "included usage";
}

/**
 * The fix a refusal on this project's plan has, when all the Studio has is
 * the refusal's words: every refusal a plan makes has the same fix, apart
 * from the organization's failed payment (Free: upgrade; a Hosted trial: a
 * card; a paying Hosted project: extra usage; Pro: the payment). What
 * `/access` already refuses is asked first, since it says so outright.
 */
export function likelyFix(access: StudioAccess): PlanFix {
  if (access.plan?.access === "read-only") return "update-payment";
  const limits = access.limits;
  if (limits === null) return "other";
  const { edit, publish, remoteFiles } = limits.refused;
  const refused =
    edit ??
    publish ??
    (remoteFiles?.code === "plan:remote-files" ? undefined : remoteFiles);
  if (refused !== undefined) return refused.fix;
  switch (limits.plan) {
    case "free":
      return "upgrade";
    case "hosted":
      return limits.trial?.status === "running" ||
        limits.trial?.status === "over"
        ? "add-card"
        : "allow-usage";
    case "pro":
      return "update-payment";
    default:
      return "other";
  }
}

/**
 * The button for a toast whose raw message is a refusal from Val Build --
 * recognised by the organization's Billing link (or the project's page),
 * which every refusal names and nothing else carries. A save refused through
 * the app's proxy arrives as that message alone (the proxy keeps the words,
 * not the code), so this is what puts the next step beside it: the same
 * button a notice would give, for the fix this plan's refusals have.
 */
export function isRefusalText(
  access: StudioAccess | null,
  text: string | undefined,
): boolean {
  if (access === null || text === undefined) return false;
  return [access.billingUrl, access.projectUrl].some(
    (url) => url !== null && text.includes(url),
  );
}

export function planToastAction(
  access: StudioAccess | null,
  details: string | undefined,
): PlanAction | null {
  if (access === null || details === undefined) return null;
  if (!isRefusalText(access, details)) return null;
  return fixAction(
    viewerOf(access, null),
    likelyFix(access),
    { subject: "A change in the Studio was refused", why: details },
    { ask: "Ask an owner" },
  );
}
