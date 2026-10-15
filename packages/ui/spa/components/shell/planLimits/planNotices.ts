import type { PlanFix, PlanRefusal } from "../../../utils/planRefusal";
import {
  fixAction,
  formatDay,
  formatShare,
  formatWhen,
  meterName,
  plural,
  projectNames,
  usageMonth,
  viewerOf,
  whoCanFix,
  type PlanAction,
  type PlanFormat,
  type Viewer,
} from "./planCopy";
import { readOnlyCopy, type ReadOnlyAccess } from "./readOnly";
import {
  STORAGE_METERS,
  TRAFFIC_METERS,
  TRIAL_PUBLISHES,
  type LimitRefusal,
  type StudioAccess,
  type UsageSummary,
} from "./studioAccess";

/**
 * What the Studio says above the editor about the plan: one notice at a time,
 * the most pressing first.
 *
 * 0. The organization made the Studio read-only (a failed payment).
 * 1. A save is refused: Free's 1,000 changes, a Hosted trial that ended.
 * 2. A publish is refused: a Hosted trial's 3 publishes.
 * 3. An upload is refused: storage used up, remote files on Free.
 * 4. A Hosted month's included traffic is used up.
 * 5. A Hosted month is past 80% of something.
 *
 * Each one says what happened in the reader's terms and offers the next step
 * beside it (CLAUDE.md, "An error says what the person can do about it"): the
 * fix for an owner, and for anyone else the owners by name and a way to ask
 * them. One Val Build has not told us about yet -- an unknown code -- is still
 * said, generically, with Billing; never silence while writes are refused.
 */
export type PlanNotice = {
  /** Stable while it stays true: what a dismissal remembers. */
  id: string;
  /** Its place in the order above. */
  rank: number;
  tone: "critical" | "warning" | "info";
  icon: "lock" | "alert" | "pause" | "info";
  title: string;
  body: string;
  action: PlanAction | null;
  /** Beside the action: "4 changes waiting". */
  aside: string | null;
  /** A bar, 0–1: how much of a limit is used. */
  meter: number | null;
  /** Val Build's own sentence, under "Details", for support. */
  details: string | null;
  /**
   * How it can be put away. `refusal`: it is about one refused write, and
   * goes until the next one. `session`: a warning, gone until reload. `null`:
   * it stays while it is true.
   */
  dismiss: "refusal" | "session" | null;
};

export type PlanNoticeContext = PlanFormat & {
  /**
   * The project's own name: `website` of `acme/website`. Null when the
   * Studio does not know it, and the notices say "this project".
   */
  project: string | null;
  /** This user's changes waiting to be published, if known. */
  changesWaiting?: number;
};

type Source = { refusal: LimitRefusal; details: string | null } & (
  | { from: "access" }
  | { from: "refusal" }
);

/**
 * The organization's read-only notice (a failed payment): `readOnlyCopy`'s
 * words, and -- for someone who cannot fix it and has no owners to write to
 * -- the project's page in Val Build, where the owners are listed, rather
 * than no button. `ReadOnlyCard` is this.
 */
export function readOnlyNotice(
  readOnly: ReadOnlyAccess,
  projectUrl: string | null,
  dismiss: PlanNotice["dismiss"] = null,
): PlanNotice {
  const copy = readOnlyCopy(readOnly);
  return {
    id: "read-only",
    rank: 0,
    tone: "critical",
    icon: "lock",
    title: copy.title,
    body: copy.body,
    action:
      copy.action ??
      // No owners to write to: their names are on the project's page.
      (projectUrl !== null
        ? { label: "Open in Val Build", href: projectUrl, external: true }
        : null),
    aside: null,
    meter: null,
    details: null,
    dismiss,
  };
}

/**
 * A read-only notice for an organization's refusal that came WITHOUT the
 * organization's own answer: a project limit saying `payment-failed`, or a
 * 403 saying `read-only`. Built from who is asking, when that is known.
 */
function readOnlyFrom(
  viewer: Viewer,
  dismiss: PlanNotice["dismiss"],
): PlanNotice {
  const why =
    "A payment failed, so nothing can be saved or published until it is paid. The site keeps running.";
  if (viewer.billingUrl === null) {
    return {
      id: "read-only",
      rank: 0,
      tone: "critical",
      icon: "lock",
      title: "This Studio is read-only",
      body: why + whoCanFix(viewer, "update-payment"),
      action: fixAction(viewer, "update-payment", {
        subject: "The Studio is read-only: a payment failed",
        why,
      }),
      aside: null,
      meter: null,
      details: null,
      dismiss,
    };
  }
  return readOnlyNotice(
    {
      access: "read-only",
      reason: "payment-failed",
      billingUrl: viewer.billingUrl,
      org: viewer.org ?? "your organization",
      // Unknown is offered the owner's button: Billing knows who may.
      canFix: viewer.canFix !== false,
      owners: viewer.owners,
    },
    viewer.projectUrl,
    dismiss,
  );
}

function base(
  id: string,
  rank: number,
  source: Source,
): Pick<PlanNotice, "id" | "rank" | "details" | "dismiss" | "aside" | "meter"> {
  return {
    id,
    rank,
    details: source.details,
    dismiss: source.from === "refusal" ? "refusal" : null,
    aside: null,
    meter: null,
  };
}

function changesNotice(
  source: Source,
  access: StudioAccess | null,
  viewer: Viewer,
  ctx: PlanNoticeContext,
): PlanNotice {
  const changes = access?.limits?.changes ?? null;
  const limit = plural(changes?.limit ?? 1000, "change", "changes", ctx);
  const until = source.refusal.until ?? changes?.nextAt ?? null;
  const named = projectNames(ctx.project);
  const title = `${named.start} has used this week's ${limit}`;
  const reopens =
    until === null
      ? "Editing opens again as last week's changes drop out of the 7 days."
      : `Editing opens again ${formatWhen(until, ctx)}, as last week's changes drop out of the 7 days.`;
  return {
    ...base("limit:changes", 1, source),
    tone: "warning",
    icon: "alert",
    title,
    body:
      `Everything so far is saved. ${reopens} Pro has no limit.` +
      whoCanFix(viewer, source.refusal.fix),
    action: fixAction(viewer, source.refusal.fix, {
      subject: title,
      why: `${title} on the Free plan, so it cannot be edited until older changes drop out of the 7 days. Pro has no limit.`,
    }),
    meter: changes === null ? 1 : Math.min(changes.used / changes.limit, 1),
  };
}

function trialOverNotice(
  source: Source,
  access: StudioAccess | null,
  viewer: Viewer,
  ctx: PlanNoticeContext,
): PlanNotice {
  const trial = access?.limits?.trial;
  const pauseAt = trial?.status === "over" ? trial.pauseAt : null;
  const paused = pauseAt !== null && Date.parse(pauseAt) <= ctx.now.getTime();
  const site =
    pauseAt === null
      ? ""
      : paused
        ? " The site is paused for visitors."
        : ` The site keeps running until ${formatDay(pauseAt, ctx)}, and is paused after that.`;
  const owner = viewer.canFix !== false;
  const named = projectNames(ctx.project);
  return {
    ...base("trial-over", 1, source),
    tone: "warning",
    icon: owner ? "alert" : "lock",
    title: owner
      ? `The trial for ${named.mid} has ended`
      : "Editing is paused: the trial has ended",
    body:
      `The Studio is read-only.${site}` +
      (owner
        ? paused
          ? " Add a card to edit and start the site again."
          : pauseAt === null
            ? " Add a card to carry on."
            : " Add a card to keep both."
        : whoCanFix(viewer, source.refusal.fix)),
    action: fixAction(viewer, source.refusal.fix, {
      subject: `The trial for ${named.mid} has ended`,
      why: `The trial for ${named.mid} has ended, so its Studio is read-only.${site}`,
    }),
  };
}

function trialPublishesNotice(
  source: Source,
  access: StudioAccess | null,
  viewer: Viewer,
  ctx: PlanNoticeContext,
): PlanNotice {
  const trial = access?.limits?.trial;
  const endsAt =
    trial?.status === "running" || trial?.status === "running-with-card"
      ? trial.endsAt
      : null;
  const owner = viewer.canFix !== false;
  const waiting = ctx.changesWaiting ?? 0;
  const named = projectNames(ctx.project);
  const publishes = plural(TRIAL_PUBLISHES, "publish", "publishes", ctx);
  return {
    ...base("trial-publishes", 2, source),
    tone: "info",
    icon: "info",
    title: `The trial's ${publishes} are used`,
    body: owner
      ? "Keep editing: your changes are saved and will go out with your next publish. Add a card to publish again." +
        (endsAt === null
          ? ""
          : ` You are not charged until ${formatDay(endsAt, ctx)}.`)
      : "Keep editing: your changes are saved and will go out with the next publish." +
        whoCanFix(viewer, source.refusal.fix),
    action: fixAction(viewer, source.refusal.fix, {
      subject: `${named.start}: the trial's ${publishes} are used`,
      why:
        `The trial for ${named.mid} has used its ${publishes}, so nothing more can be published until a card is added.` +
        (endsAt === null
          ? ""
          : ` Nothing is charged before ${formatDay(endsAt, ctx)}.`),
    }),
    aside:
      waiting > 0
        ? `${plural(waiting, "change", "changes", ctx)} waiting`
        : null,
  };
}

function remoteFilesNotice(
  source: Source,
  viewer: Viewer,
  ctx: PlanNoticeContext,
): PlanNotice {
  const named = projectNames(ctx.project);
  return {
    ...base("plan:remote-files", 3, source),
    tone: "warning",
    icon: "alert",
    title: "Remote files are part of Pro",
    body:
      `${named.start} is on the Free plan, so new images and files cannot be uploaded to Val's remote storage. Text edits save and publish as normal.` +
      whoCanFix(viewer, source.refusal.fix),
    action: fixAction(viewer, source.refusal.fix, {
      subject: `${named.start}: remote files are part of Pro`,
      why: `${named.start} is on the Free plan, so new images and files cannot be uploaded to Val's remote storage.`,
    }),
  };
}

/**
 * Storage used up. From a refusal (a 403, or `/access` refusing uploads)
 * uploads ARE refused, and it says so. From `usage.out` alone it may not be:
 * Val Build lists a meter there whatever the project's over-usage policy,
 * which `/access` does not send -- so it says what happens if the project
 * is set to pause, and can be put away.
 */
function storageNotice(
  source: Source,
  usage: UsageSummary | null,
  viewer: Viewer,
  ctx: PlanNoticeContext,
  refused: boolean,
): PlanNotice {
  const month = usageMonth(usage?.resetsAt ?? null, ctx);
  const named = projectNames(ctx.project);
  const title =
    month === null
      ? `${named.start} has used this month's included storage`
      : `${named.start} has used ${month.month}'s included storage`;
  const until = month === null ? "" : ` until ${month.resetDay}`;
  const what = refused
    ? `New files cannot be uploaded${until}, unless the project allows extra usage.`
    : `If the project is set to pause, which is the default, new files cannot be uploaded${until}. Allowing extra usage lifts that.`;
  const common = base("usage:storage", 3, source);
  return {
    ...common,
    tone: "warning",
    icon: "alert",
    title,
    body:
      `${what} Text edits save and publish as normal.` +
      whoCanFix(viewer, source.refusal.fix),
    action: fixAction(viewer, source.refusal.fix, {
      subject: title,
      why: `${title}. ${what}`,
    }),
    dismiss: refused ? common.dismiss : "session",
  };
}

/** A code this Studio does not know: said plainly, with Billing. */
function unknownNotice(
  write: "edit" | "publish" | "remoteFiles" | "unknown",
  source: Source,
  viewer: Viewer,
  ctx: PlanNoticeContext,
): PlanNotice {
  const project = projectNames(ctx.project).mid;
  const copy = {
    edit: {
      title: "Editing is paused",
      body: `Val Build is not accepting changes to ${project} right now, because of its plan.`,
      rank: 1,
    },
    publish: {
      title: "Publishing is paused",
      body: `Val Build is not publishing ${project} right now, because of its plan. Your changes stay saved.`,
      rank: 2,
    },
    remoteFiles: {
      title: "Uploads are paused",
      body: `Val Build is not accepting new files for ${project} right now, because of its plan. Text edits save and publish as normal.`,
      rank: 3,
    },
    unknown: {
      title: "Val Build refused a change",
      body: `Val Build refused a change to ${project} because of its plan.`,
      rank: 1,
    },
  }[write];
  return {
    ...base(`${write}:${source.refusal.rawCode}`, copy.rank, source),
    tone: "warning",
    icon: "alert",
    title: copy.title,
    body: copy.body + whoCanFix(viewer, source.refusal.fix),
    action: fixAction(viewer, source.refusal.fix, {
      subject: `${projectNames(ctx.project).start}: ${copy.title.toLowerCase()}`,
      why: copy.body,
    }),
  };
}

function refusalNotice(
  write: "edit" | "publish" | "remoteFiles" | "unknown",
  source: Source,
  access: StudioAccess | null,
  viewer: Viewer,
  ctx: PlanNoticeContext,
): PlanNotice | null {
  switch (source.refusal.code) {
    case "read-only":
    case "payment-failed":
      return readOnlyFrom(viewer, source.from === "refusal" ? "refusal" : null);
    case "limit:changes":
      return changesNotice(source, access, viewer, ctx);
    case "trial-over":
      return trialOverNotice(source, access, viewer, ctx);
    case "trial-publishes":
      return trialPublishesNotice(source, access, viewer, ctx);
    case "plan:remote-files":
      return remoteFilesNotice(source, viewer, ctx);
    case "usage:storage":
      return storageNotice(
        source,
        access?.limits?.usage ?? null,
        viewer,
        ctx,
        true,
      );
    case "other":
      return unknownNotice(write, source, viewer, ctx);
  }
}

const ALLOW_USAGE: PlanFix = "allow-usage";

function usageOutNotice(
  usage: UsageSummary,
  viewer: Viewer,
  ctx: PlanNoticeContext,
): PlanNotice | null {
  if (!usage.out.some((meter) => TRAFFIC_METERS.includes(meter))) return null;
  const month = usageMonth(usage.resetsAt, ctx);
  const named = projectNames(ctx.project);
  const title =
    month === null
      ? `${named.start} has used this month's included traffic`
      : `${named.start} has used ${month.month}'s included traffic`;
  const until = month === null ? "" : ` until ${month.resetDay}`;
  /*
   * Whether the site is paused depends on the project's over-usage policy,
   * which `/access` does not send -- and Val Build lists a meter in `out`
   * whatever the policy is. Pausing is the default, so this says what
   * happens then, and goes where the policy is set. Dismissible, since it
   * may be about a site that was set never to pause.
   */
  const what = `If the project is set to pause, which is the default, visitors see a paused page${until}.`;
  return {
    id: "usage:out",
    rank: 4,
    tone: "warning",
    icon: "pause",
    title,
    body:
      `${what} Allowing extra usage keeps the site running. The Studio still works and your changes are saved.` +
      whoCanFix(viewer, ALLOW_USAGE),
    action: fixAction(viewer, ALLOW_USAGE, {
      subject: title,
      why: `${title}. ${what}`,
    }),
    aside: null,
    meter: 1,
    details: null,
    dismiss: "session",
  };
}

function usageWarnNotice(
  usage: UsageSummary,
  viewer: Viewer,
  ctx: PlanNoticeContext,
): PlanNotice | null {
  const fullest = usage.meters
    .filter((meter) => usage.warn.includes(meter.meter))
    .sort((a, b) => b.share - a.share)[0];
  if (fullest === undefined) return null;
  const month = usageMonth(usage.resetsAt, ctx);
  const share = formatShare(fullest.share, ctx);
  const named = projectNames(ctx.project);
  const title =
    month === null
      ? `${named.start} has used ${share} of this month's ${meterName(fullest.meter)}`
      : `${named.start} has used ${share} of ${month.month}'s ${meterName(fullest.meter)}`;
  const until = month === null ? "" : ` until ${month.resetDay}`;
  const runsOut = STORAGE_METERS.includes(fullest.meter)
    ? `If it runs out, new files cannot be uploaded${until}, unless the project allows extra usage.`
    : `If it runs out, the site pauses${until}, unless the project allows extra usage.`;
  return {
    id: `usage:warn:${fullest.meter}`,
    rank: 5,
    tone: "info",
    icon: "info",
    title,
    body: runsOut + whoCanFix(viewer, ALLOW_USAGE),
    action: fixAction(viewer, ALLOW_USAGE, {
      subject: title,
      why: `${title}. ${runsOut}`,
    }),
    aside: null,
    meter: Math.min(fullest.share, 1),
    details: null,
    dismiss: "session",
  };
}

/** Which write a refusal's code is about, for the order. */
function writeOfCode(
  code: PlanRefusal["code"],
): "edit" | "publish" | "remoteFiles" | "unknown" {
  switch (code) {
    case "trial-publishes":
      return "publish";
    case "plan:remote-files":
    case "usage:storage":
      return "remoteFiles";
    case "other":
      return "unknown";
    default:
      return "edit";
  }
}

/**
 * Every plan notice that is true now, most pressing first. `refusal` is the
 * last write Val Build refused, as its 403 said it: shown when `/access` does
 * not already say the same, and put away with a dismissal.
 */
export function planNoticesOf(
  access: StudioAccess | null,
  refusal: PlanRefusal | null,
  ctx: PlanNoticeContext,
): PlanNotice[] {
  const viewer = viewerOf(access, refusal?.billingUrl ?? null);
  const notices: PlanNotice[] = [];
  const push = (notice: PlanNotice | null) => {
    if (notice !== null && !notices.some((n) => n.id === notice.id)) {
      notices.push(notice);
    }
  };
  if (access?.plan?.access === "read-only") {
    push(readOnlyNotice(access.plan, viewer.projectUrl, null));
  }
  const limits = access?.limits ?? null;
  if (limits !== null) {
    const { edit, publish, remoteFiles } = limits.refused;
    if (edit !== undefined) {
      push(
        refusalNotice(
          "edit",
          { refusal: edit, details: null, from: "access" },
          access,
          viewer,
          ctx,
        ),
      );
    }
    // The same refusal on every write (a trial that ended) is said once.
    if (publish !== undefined && publish.rawCode !== edit?.rawCode) {
      push(
        refusalNotice(
          "publish",
          { refusal: publish, details: null, from: "access" },
          access,
          viewer,
          ctx,
        ),
      );
    }
    /*
     * Remote files are refused on EVERY Free project, all the time: that is
     * said where an upload is tried (the refusal below), not above the editor
     * of a project that may never upload one. Likewise a code this Studio
     * does not know, which may be just as permanent.
     */
    if (
      remoteFiles !== undefined &&
      remoteFiles.rawCode !== edit?.rawCode &&
      remoteFiles.code !== "plan:remote-files" &&
      remoteFiles.code !== "other"
    ) {
      push(
        refusalNotice(
          "remoteFiles",
          { refusal: remoteFiles, details: null, from: "access" },
          access,
          viewer,
          ctx,
        ),
      );
    }
    if (limits.usage !== null) {
      if (
        limits.usage.out.some((meter) => STORAGE_METERS.includes(meter)) &&
        remoteFiles?.code !== "usage:storage"
      ) {
        push(
          storageNotice(
            {
              refusal: {
                code: "usage:storage",
                rawCode: "usage:storage",
                fix: "allow-usage",
                until: null,
              },
              details: null,
              from: "access",
            },
            limits.usage,
            viewer,
            ctx,
            false,
          ),
        );
      }
      push(usageOutNotice(limits.usage, viewer, ctx));
      push(usageWarnNotice(limits.usage, viewer, ctx));
    }
  }
  if (refusal !== null) {
    push(
      refusalNotice(
        writeOfCode(refusal.code),
        {
          refusal: {
            code: refusal.code,
            rawCode: refusal.rawCode,
            fix: refusal.fix,
            until: refusal.until,
          },
          details: refusal.message,
          from: "refusal",
        },
        access,
        viewer,
        ctx,
      ),
    );
  }
  // Stable: within a rank, what `/access` says comes before a refusal.
  return notices
    .map((notice, index) => ({ notice, index }))
    .sort((a, b) => a.notice.rank - b.notice.rank || a.index - b.index)
    .map(({ notice }) => notice);
}
