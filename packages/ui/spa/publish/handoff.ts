import type { StudioDeployResult } from "./runStudioDeploy";
import type { SiteUpdateOutcome } from "./runSiteUpdate";
import type { StudioJobResult } from "./runStudioJob";
import { randomUUID } from "../utils/randomUUID";
import {
  browserStorage,
  readKeyed,
  removeKeyed,
  writeKeyed,
} from "./browserStorage";
import {
  parseRequestStatus,
  type DependencyChange,
  type PublishRequestStatus,
  type PublishTabJob,
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
 * The tab opens at the PRESS, and it is the tab that PRESSES: the page only
 * names the request. A window opened after an await has lost the click that
 * allowed it, so the tab has to open in the tap -- and on an iPhone the tab
 * then takes the screen, and iOS pauses the page behind it. Nothing the page
 * would do after the tap runs: not the AI's commit message, not the gate, not
 * the press, not the answer to the tab's `ready`. Built the other way round
 * -- the page pressing and handing the job over -- the tab sat at "Starting
 * the publish" for as long as anyone watched it. So what the tab is to do
 * ({@link HandoffIntent}) is written down in the tap, before the tab opens:
 * the tab runs the gate and the press itself, as the page's tab and under the
 * request id the page minted, and tells the page what it pressed (`pressed`),
 * which reaches the page whenever it is in front again.
 *
 * Written to this origin's `localStorage`, under the hand-off id, and NEVER
 * to the URL, which carries only the id. A URL is something anyone can send:
 * a link that said "press" would publish an editor's pending work -- and
 * everyone else's, since a job takes everything pending -- without a press,
 * for whoever opened it signed in. A page of another origin cannot write
 * here, so an intent in storage is one this browser's own tap made. The write
 * is synchronous, in the tap, so it is there before the page can be paused. A page that is awake can still hand the tab a
 * job over the channel -- queued work it took -- and the tab builds that too.
 *
 * On a desktop it is a small popup window rather than a tab, sized to the
 * publish card: see `openBuilderWindow`. iPadOS ignores the window features
 * and opens a tab, and so does a browser told to open popups as tabs, which
 * is why the rest of this file still says "tab".
 */

/** What the card says when the intent could not be stored for the tab. */
export const NOT_STORED_MESSAGE =
  "This browser would not let Val hand the publish to a new tab, so nothing was published. Allow site data for this site, or leave private browsing, then publish again.";

export const HANDOFF_PARAM = "publish-handoff";
const CHANNEL = "val-publish-handoff";
/**
 * What a builder tab is to do, decided at the tap and kept in storage by the
 * hand-off id. See the top of this file for why it is neither a message nor
 * part of the URL.
 */
export type HandoffIntent =
  /**
   * Run the gate and press Publish as `tab`, under `requestId`.
   *
   * `after`: the newest change the page had not published when it was tapped,
   * which the tab waits to see on the server before it presses. A change made
   * just before the tap is usually still being saved, and the tab presses
   * what the server has -- without the wait it published without the change,
   * or found nothing to publish.
   */
  | { kind: "press"; requestId: string; tab: string; after: string | null }
  /**
   * "Try again" on a failed publish: resume content's queue and press anew.
   * No gate, as on a page that can build -- see `PublishJobs.tryAgain`.
   */
  | {
      kind: "try-again";
      requestId: string;
      tab: string;
      replaces: string;
      after: string | null;
    }
  /** Update the site's dependencies: `runSiteUpdate`. */
  | { kind: "update" }
  /**
   * Publish a proposal -- merge it into the site -- from a page that cannot
   * build it: press the merge of `proposal` as `tab`, under `requestId`, and
   * build the job it starts. The proposal was saved before the tap (see
   * `useProposalsBar`), so there is nothing for the tab to wait for.
   */
  | { kind: "merge"; requestId: string; tab: string; proposal: string };

/** Publish a proposal, from a builder tab. See `HandoffIntent`. */
export type MergeIntent = Extract<HandoffIntent, { kind: "merge" }>;

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
  /**
   * Still here, every {@link ALIVE_EVERY_MS} for as long as the tab is open --
   * whatever it is doing, including the stretches no phase is reported in.
   * Its absence is how the site learns the tab was closed, or suspended by a
   * phone, rather than waiting for it, and holding the job, for ever.
   */
  | { type: "alive" }
  /**
   * What the tab pressed for the page ({@link HandoffIntent}), so the page
   * follows the request as one of its own -- to Live, in the status bar.
   * `building`: the press came with a job for the tab, or was queued for one;
   * otherwise it joined a job already in flight, or settled at once, and the
   * tab has nothing to build.
   */
  | {
      type: "pressed";
      requestId: string;
      request: PublishRequestStatus;
      /** What the gate checked: see `TrackedPublish.patchIds`. */
      patchIds: string[];
      /** The failed request a try again replaces. */
      replaces: string | null;
      building: boolean;
    }
  /**
   * The step the tab is on, and -- from a tab that sends it -- how far the
   * build has got, so the page that opened it draws the same bar.
   */
  | { type: "phase"; label: string; elapsedMs: number; percent?: number }
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
 * Unguessable, because it is what a builder tab finds its intent by: a link
 * naming an id this browser stored an intent under could start that publish.
 * `randomUUID` from utils, which works outside a secure context too.
 */
function newId(): string {
  return randomUUID();
}

export function handoffUrl(id: string, studioPath = "/val"): string {
  return `${studioPath}?${HANDOFF_PARAM}=${encodeURIComponent(id)}`;
}

/** One key per hand-off: see `writeKeyed`. */
const INTENT_PREFIX = "val-publish-handoff-intent:";
/** A week: long past any reload of the tab, and the list cannot grow unbounded. */
const INTENT_KEEP_MS = 7 * 24 * 60 * 60_000;
/**
 * How old an intent may be and still START anything. An older one is only
 * followed -- shown, if it ran -- never run: a tab nobody opened in time, or
 * one reopened from history, is not a press anyone is making now.
 */
export const INTENT_MAX_AGE_MS = 60 * 60_000;

/**
 * Write down what the tab `id` is to do. In the tap, before the tab opens.
 * `false` when storage would not take it: the tab then has nothing to run, and
 * says so.
 */
export function storeHandoffIntent(
  id: string,
  intent: HandoffIntent,
  storage: Storage | null = browserStorage(),
  now: number = Date.now(),
): boolean {
  if (storage === null) return false;
  return writeKeyed(storage, INTENT_PREFIX, id, intent, {
    now,
    keepMs: INTENT_KEEP_MS,
  });
}

/**
 * What this browser's tap told the tab `id` to do, and when; `null` for an id
 * no tap here stored -- a link from anywhere else, or one older than a week.
 */
export function storedHandoffIntent(
  id: string,
  storage: Storage | null = browserStorage(),
): { intent: HandoffIntent; at: number } | null {
  if (storage === null) return null;
  const entry = readKeyed(storage, INTENT_PREFIX, id);
  const intent = entry === null ? null : asIntent(entry.value);
  return entry === null || intent === null ? null : { intent, at: entry.at };
}

/**
 * Retire the intent for the tab `id`: once it has done its part and the
 * ending could not be written down, so a tab opened again does not run it
 * again. It then finds nothing to run, and says so.
 */
export function forgetHandoffIntent(
  id: string,
  storage: Storage | null = browserStorage(),
): void {
  if (storage === null) return;
  removeKeyed(storage, INTENT_PREFIX, id);
}

/* Read back structurally: storage is the origin's, and anything may be there. */
function asIntent(value: unknown): HandoffIntent | null {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return null;
  }
  if (value.kind === "update") return { kind: "update" };
  const text = (key: string): string | null => {
    const field: unknown = key in value ? Reflect.get(value, key) : undefined;
    return typeof field === "string" && field !== "" ? field : null;
  };
  const requestId = text("requestId");
  const tab = text("tab");
  if (requestId === null || tab === null) return null;
  const after = text("after");
  if (value.kind === "press") return { kind: "press", requestId, tab, after };
  const proposal = text("proposal");
  if (value.kind === "merge" && proposal !== null) {
    return { kind: "merge", requestId, tab, proposal };
  }
  const replaces = text("replaces");
  if (value.kind === "try-again" && replaces !== null) {
    return { kind: "try-again", requestId, tab, replaces, after };
  }
  return null;
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
  /**
   * `false` when the intent could not be stored. Then no tab was opened --
   * one would find nothing to run, and the page would wait on it for ever.
   */
  stored: boolean;
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
    /** What the tab does on its own, page or no page: stored, not in the URL. */
    intent?: HandoffIntent;
    storage?: Storage | null;
  } = {},
): SiteHandoff {
  const id = newId();
  // Before the tab opens: it reads this as soon as it loads.
  const stored =
    options.intent === undefined ||
    storeHandoffIntent(id, options.intent, options.storage);
  const url = handoffUrl(id, options.studioPath);
  const open = options.open ?? openBuilderWindow;
  const opened = stored && open(url, `val-publish-${id}`) !== null;
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
    stored,
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
  report: (message: Exclude<ToSite, { type: "ready" | "alive" }>) => void;
  close: () => void;
};

/** How often a tab says it is still there. See `alive` on {@link ToSite}. */
export const ALIVE_EVERY_MS = 2_000;

export function joinHandoff(
  id: string,
  onMessage: (message: ToTab) => void,
  options: { retryMs?: number; aliveMs?: number } = {},
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
  const alive = setInterval(
    () => post({ type: "alive" }),
    options.aliveMs ?? ALIVE_EVERY_MS,
  );
  return {
    report: (message) => post(message),
    close: () => {
      clearInterval(timer);
      clearInterval(alive);
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
  if (message.type === "alive") return { type: "alive" };
  if (
    message.type === "pressed" &&
    "requestId" in message &&
    typeof message.requestId === "string" &&
    "request" in message &&
    "patchIds" in message &&
    Array.isArray(message.patchIds) &&
    "building" in message &&
    typeof message.building === "boolean"
  ) {
    const request = asRequestStatus(message.request);
    if (request === null) return null;
    return {
      type: "pressed",
      requestId: message.requestId,
      request,
      patchIds: message.patchIds.filter(
        (patchId): patchId is string => typeof patchId === "string",
      ),
      replaces:
        "replaces" in message && typeof message.replaces === "string"
          ? message.replaces
          : null,
      building: message.building,
    };
  }
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
      ...("percent" in message && typeof message.percent === "number"
        ? { percent: message.percent }
        : {}),
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

/** Content's own reader, so the two cannot disagree about what a status is. */
function asRequestStatus(value: unknown): PublishRequestStatus | null {
  try {
    return parseRequestStatus({ request: value }).request;
  } catch {
    return null;
  }
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
      return {
        status: "handed-off",
        jobId: value.jobId,
        built: !("built" in value) || value.built !== false,
      };
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
