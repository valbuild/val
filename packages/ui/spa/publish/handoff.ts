import type { StudioDeployResult } from "./runStudioDeploy";
import type { SiteUpdateOutcome } from "./runSiteUpdate";
import type { StudioJobResult } from "./runStudioJob";
import type {
  DependencyChange,
  PublishTabJob,
} from "@valbuild/shared/internal";

/**
 * Publishing from a page that cannot build, by handing the build to a Studio
 * tab.
 *
 * The bundler runs on WASI threads that share memory, which a browser allows
 * only in a cross-origin isolated document -- and only the Studio is one:
 * isolating the customer's own pages would break their embeds (see
 * `STUDIO_ISOLATION` in the platform's loader). So a publish from the overlay
 * is REQUESTED on the site, and the publish job content hands the site is
 * built by a Studio tab it opened, reporting back over a `BroadcastChannel`.
 * The tab runs the job as the site's tab -- the job is leased to the tab that
 * pressed -- so content sees one tab throughout.
 *
 * A channel rather than `postMessage` to the window: the Studio document is
 * `Cross-Origin-Opener-Policy: same-origin`, which severs the opener's handle
 * to it the moment it loads. A channel is same-origin and needs no handle.
 *
 * The tab opens at the PRESS, before the request: a window opened after an
 * await has lost the click that allowed it, and the browser blocks it. So the
 * tab starts out waiting, and is told the job when content has handed one.
 *
 * On a desktop it is a small popup window rather than a tab, sized to the
 * publish card: see `openBuilderWindow`. iPadOS ignores the window features
 * and opens a tab, and so does a browser told to open popups as tabs, which
 * is why the rest of this file still says "tab".
 */

export const HANDOFF_PARAM = "publish-handoff";
const CHANNEL = "val-publish-handoff";

/** Site -> tab. */
export type ToTab =
  | {
      type: "job";
      job: PublishTabJob;
      /** The site's tab id: the job is leased to it, and reported as it. */
      tab: string;
      /** The press the job is for, so the tab can say when it is Live. */
      requestId: string | null;
    }
  /** The press did not start a job, so there is nothing to build. */
  | { type: "cancel"; message: string }
  /**
   * Update the site's dependencies (`runSiteUpdate`) instead of publishing a
   * job. Nothing is requested first, so there is nothing to wait for: the page
   * sends this at the press, and the tab starts as soon as it hears it.
   */
  | { type: "update" };

/** Tab -> site. */
export type ToSite =
  /** Listening. The site answers with the job, if it has one yet. */
  | { type: "ready" }
  | { type: "phase"; label: string; elapsedMs: number }
  /**
   * The tab's part of the job is over: handed to content, lost, or failed.
   * What the site's own job runner waits for; `done` follows, once the
   * publish is Live or has failed.
   */
  | { type: "job-result"; result: StudioJobResult }
  | {
      type: "done";
      result: StudioDeployResult;
      ms: number;
      /**
       * What went wrong, in a sentence, when it failed -- decided in the tab,
       * which knows the step it failed at and whether IT could build. The
       * result's own message is the technical details.
       */
      summary?: string;
    }
  /**
   * How an update ended. Its own message rather than `done`, because an
   * update can end without deploying anything at all -- already current, or
   * refused by the platform -- and those are answers, not failed publishes.
   */
  | { type: "update-done"; outcome: SiteUpdateOutcome };

type Envelope<T> = { id: string; message: T };

/** Can a build run in this document? */
export function canBuildHere(): boolean {
  return globalThis.crossOriginIsolated === true;
}

/**
 * Not `crypto.randomUUID`: that is secure-context only, and a site edited over
 * plain http -- a local dev server on a LAN address -- has no secure context.
 * This only has to tell two publishes of one browser apart.
 */
function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function handoffUrl(id: string, studioPath = "/val"): string {
  return `${studioPath}?${HANDOFF_PARAM}=${encodeURIComponent(id)}`;
}

/** The publish card is `max-w-md` (448px) with a 24px gutter each side. */
const WINDOW_WIDTH = 480;
/** Ten steps, the heading and the result's buttons, without a scrollbar. */
const WINDOW_HEIGHT = 680;

type ScreenScope = {
  screenX?: number;
  screenY?: number;
  outerWidth?: number;
  outerHeight?: number;
};

/**
 * The features that make `window.open` a popup window over the page rather
 * than a tab: centred across it, a third of the way down.
 *
 * Never `noopener`. With it `window.open` returns `null`, which is how
 * `openHandoff` learns the browser blocked the window, so every handoff would
 * read as blocked. The opener's handle is severed anyway: the Studio document
 * is COOP `same-origin`.
 */
export function builderWindowFeatures(scope: ScreenScope = globalThis): string {
  const at = (
    origin: number | undefined,
    outer: number | undefined,
    size: number,
    share: number,
  ) =>
    typeof origin === "number" && typeof outer === "number" && outer > size
      ? Math.round(origin + (outer - size) * share)
      : null;
  const left = at(scope.screenX, scope.outerWidth, WINDOW_WIDTH, 1 / 2);
  const top = at(scope.screenY, scope.outerHeight, WINDOW_HEIGHT, 1 / 3);
  return [
    "popup",
    `width=${WINDOW_WIDTH}`,
    `height=${WINDOW_HEIGHT}`,
    ...(left !== null ? [`left=${left}`] : []),
    ...(top !== null ? [`top=${top}`] : []),
  ].join(",");
}

/**
 * Open (or re-open: the name is the handoff's, so a second press reuses the
 * window) the builder at `url`. `null` when the browser refused.
 */
export function openBuilderWindow(url: string, target: string): Window | null {
  return window.open(url, target, builderWindowFeatures());
}

/**
 * Go on to the site or the Studio from the builder: in a tab of its own, and
 * close the builder.
 *
 * On a desktop the builder is a popup the size of the publish card, which is
 * no place to read a site in. It cannot tell that it is one: the COOP swap
 * into the Studio document drops "is popup", so `locationbar.visible` reads
 * true in the popup too (measured in Chromium, headed and headless). It does
 * not need to. The builder is always opened by script -- at the press, or by
 * "Open the Studio to publish" -- so it may close itself, and where it is a
 * tab after all (iPadOS) this lands on the same page a navigation would.
 *
 * In place only when the browser refuses the new tab.
 */
export function leaveTo(
  href: string,
  scope: {
    open: (url: string, target: string) => unknown;
    close: () => void;
    location: { href: string };
  } = window,
) {
  if (scope.open(href, "_blank") !== null) {
    scope.close();
    return;
  }
  scope.location.href = href;
}

function channelOf(): BroadcastChannel | null {
  return typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel(CHANNEL);
}

/**
 * The site's end: opened at the press, told the job once content hands one.
 *
 * `opened` is false when the browser refused the tab. The handoff still works
 * then -- a tab opened later from `url` finds the job here -- which is what
 * the "Open the Studio to publish" button does.
 */
export type SiteHandoff = {
  id: string;
  url: string;
  opened: boolean;
  /** Hand the tab the job to build. Re-sent whenever a tab says it is ready. */
  job: (payload: Extract<ToTab, { type: "job" }>) => void;
  /** Ask the tab to run an update. Re-sent whenever a tab says it is ready. */
  update: () => void;
  cancel: (message: string) => void;
  onMessage: (listener: (message: ToSite) => void) => () => void;
  close: () => void;
};

export function openHandoff(
  options: {
    open?: (url: string, target: string) => unknown;
    studioPath?: string;
  } = {},
): SiteHandoff {
  const id = newId();
  const url = handoffUrl(id, options.studioPath);
  const open = options.open ?? openBuilderWindow;
  const opened = open(url, `val-publish-${id}`) !== null;
  const channel = channelOf();
  let pending: ToTab | null = null;
  const listeners = new Set<(message: ToSite) => void>();
  const send = (message: ToTab) => {
    const envelope: Envelope<ToTab> = { id, message };
    channel?.postMessage(envelope);
  };
  if (channel) {
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const envelope = asEnvelope(event.data);
      if (envelope === null || envelope.id !== id) return;
      const message = asToSite(envelope.message);
      if (message === null) return;
      // A tab that came up after the job was sent asks for it again.
      if (message.type === "ready" && pending !== null) send(pending);
      for (const listener of listeners) listener(message);
    };
  }
  return {
    id,
    url,
    opened,
    job: (payload) => {
      pending = payload;
      send(payload);
    },
    update: () => {
      pending = { type: "update" };
      send(pending);
    },
    cancel: (message) => {
      pending = { type: "cancel", message };
      send(pending);
    },
    onMessage: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => channel?.close(),
  };
}

/**
 * The tab's end: ask for the job, then report.
 *
 * `ready` is repeated until the job arrives, because the site may not have
 * one yet -- the press runs after the tab opens -- and a message sent before
 * the other end listens is simply lost.
 */
export type TabHandoff = {
  report: (message: Exclude<ToSite, { type: "ready" }>) => void;
  close: () => void;
};

export function joinHandoff(
  id: string,
  onMessage: (message: ToTab) => void,
  options: { retryMs?: number } = {},
): TabHandoff {
  const channel = channelOf();
  let answered = false;
  const post = (message: ToSite) => {
    const envelope: Envelope<ToSite> = { id, message };
    channel?.postMessage(envelope);
  };
  if (channel) {
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const envelope = asEnvelope(event.data);
      if (envelope === null || envelope.id !== id) return;
      const message = asToTab(envelope.message);
      if (message === null) return;
      answered = true;
      onMessage(message);
    };
  }
  post({ type: "ready" });
  const timer = setInterval(() => {
    if (answered) clearInterval(timer);
    else post({ type: "ready" });
  }, options.retryMs ?? 500);
  return {
    report: (message) => post(message),
    close: () => {
      clearInterval(timer);
      channel?.close();
    },
  };
}

function asEnvelope(data: unknown): { id: string; message: unknown } | null {
  if (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    typeof data.id === "string" &&
    "message" in data
  ) {
    return { id: data.id, message: data.message };
  }
  return null;
}

/*
 * The two message types are read back structurally: a channel is shared by
 * every tab of the origin, and what arrives is whatever someone posted.
 */
function asToTab(message: unknown): ToTab | null {
  if (typeof message !== "object" || message === null || !("type" in message))
    return null;
  if (message.type === "cancel" && "message" in message) {
    return {
      type: "cancel",
      message: typeof message.message === "string" ? message.message : "",
    };
  }
  if (message.type === "update") return { type: "update" };
  if (
    message.type === "job" &&
    "job" in message &&
    "tab" in message &&
    typeof message.tab === "string"
  ) {
    const job = asTabJob(message.job);
    if (job === null) return null;
    const requestId =
      "requestId" in message && typeof message.requestId === "string"
        ? message.requestId
        : null;
    return { type: "job", job, tab: message.tab, requestId };
  }
  return null;
}

function asTabJob(value: unknown): PublishTabJob | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("patches" in value) ||
    !Array.isArray(value.patches)
  ) {
    return null;
  }
  const step =
    "step" in value &&
    (value.step === "prepare" ||
      value.step === "build" ||
      value.step === "upload")
      ? value.step
      : null;
  const base =
    "base" in value && typeof value.base === "string" ? value.base : null;
  return {
    id: value.id,
    step,
    base,
    patches: value.patches.filter(
      (patch): patch is string => typeof patch === "string",
    ),
  };
}

function asToSite(message: unknown): ToSite | null {
  if (typeof message !== "object" || message === null || !("type" in message))
    return null;
  if (message.type === "ready") return { type: "ready" };
  if (
    message.type === "phase" &&
    "label" in message &&
    typeof message.label === "string" &&
    "elapsedMs" in message &&
    typeof message.elapsedMs === "number"
  ) {
    return {
      type: "phase",
      label: message.label,
      elapsedMs: message.elapsedMs,
    };
  }
  if (message.type === "job-result" && "result" in message) {
    const result = asJobResult(message.result);
    return result === null ? null : { type: "job-result", result };
  }
  if (message.type === "update-done" && "outcome" in message) {
    const outcome = asUpdateOutcome(message.outcome);
    return outcome === null ? null : { type: "update-done", outcome };
  }
  if (
    message.type === "done" &&
    "result" in message &&
    "ms" in message &&
    typeof message.ms === "number"
  ) {
    const result = asResult(message.result);
    if (result === null) return null;
    return "summary" in message && typeof message.summary === "string"
      ? { type: "done", result, ms: message.ms, summary: message.summary }
      : { type: "done", result, ms: message.ms };
  }
  return null;
}

function asUpdateOutcome(value: unknown): SiteUpdateOutcome | null {
  if (typeof value !== "object" || value === null || !("status" in value))
    return null;
  const message =
    "message" in value && typeof value.message === "string"
      ? value.message
      : "";
  switch (value.status) {
    case "updated":
      return {
        status: "updated",
        changes:
          "changes" in value && Array.isArray(value.changes)
            ? value.changes.flatMap(asDependencyChange)
            : [],
      };
    case "current":
      return { status: "current" };
    case "unavailable":
      return { status: "unavailable", message };
    case "failed":
      return {
        status: "failed",
        message: message || "The update could not be published.",
        details:
          "details" in value && typeof value.details === "string"
            ? value.details
            : "",
        // The deploy's own record stays in the tab; the page shows the words.
        deploy: null,
      };
  }
  return null;
}

function asDependencyChange(change: unknown): DependencyChange[] {
  if (
    typeof change !== "object" ||
    change === null ||
    !("name" in change) ||
    typeof change.name !== "string" ||
    !("section" in change) ||
    (change.section !== "dependencies" && change.section !== "devDependencies")
  ) {
    return [];
  }
  const from =
    "from" in change && typeof change.from === "string" ? change.from : null;
  // `null` is a removal. Anything else that is not a version is not a change.
  if (
    !("to" in change) ||
    (typeof change.to !== "string" && change.to !== null)
  )
    return [];
  return [{ name: change.name, section: change.section, from, to: change.to }];
}

function asJobResult(value: unknown): StudioJobResult | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("status" in value) ||
    !("jobId" in value) ||
    typeof value.jobId !== "string"
  )
    return null;
  switch (value.status) {
    case "handed-off":
      return { status: "handed-off", jobId: value.jobId };
    case "lost":
      return { status: "lost", jobId: value.jobId };
    case "failed":
      return {
        status: "failed",
        jobId: value.jobId,
        message:
          "message" in value && typeof value.message === "string"
            ? value.message
            : "The publish failed.",
      };
  }
  return null;
}

function asResult(value: unknown): StudioDeployResult | null {
  if (typeof value !== "object" || value === null || !("status" in value))
    return null;
  const url =
    "url" in value && typeof value.url === "string" ? value.url : null;
  if (value.status === "live") return { status: "live", url };
  if (value.status === "already-live") return { status: "already-live", url };
  if (value.status === "failed") {
    return {
      status: "failed",
      message:
        "message" in value && typeof value.message === "string"
          ? value.message
          : "The publish failed.",
      problems: [],
    };
  }
  return null;
}
