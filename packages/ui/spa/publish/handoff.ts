import type { StudioDeployResult } from "./runStudioDeploy";
import type { CommittedBinaryFiles } from "./runStudioDeploy";

/**
 * Publishing from a page that cannot build, by handing the build to a Studio
 * tab.
 *
 * The bundler runs on WASI threads that share memory, which a browser allows
 * only in a cross-origin isolated document -- and only the Studio is one:
 * isolating the customer's own pages would break their embeds (see
 * `STUDIO_ISOLATION` in the platform's loader). So a publish from the overlay
 * commits on the site, and a Studio tab it opened builds and publishes that
 * commit, reporting back over a `BroadcastChannel`.
 *
 * A channel rather than `postMessage` to the window: the Studio document is
 * `Cross-Origin-Opener-Policy: same-origin`, which severs the opener's handle
 * to it the moment it loads. A channel is same-origin and needs no handle.
 *
 * The tab opens at the PRESS, before the save: a window opened after an await
 * has lost the click that allowed it, and the browser blocks it. So the tab
 * starts out waiting, and is told the commit when the save has made one.
 */

export const HANDOFF_PARAM = "publish-handoff";
const CHANNEL = "val-publish-handoff";

/** Site -> tab. */
export type ToTab =
  | {
      type: "commit";
      commit: string | null;
      binaryFiles: CommittedBinaryFiles | null;
      branch: string | null;
    }
  /** The save did not happen, so there is nothing to build. */
  | { type: "cancel"; message: string };

/** Tab -> site. */
export type ToSite =
  /** Listening. The site answers with the commit, if it has one yet. */
  | { type: "ready" }
  | { type: "phase"; label: string; elapsedMs: number }
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
    };

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

function channelOf(): BroadcastChannel | null {
  return typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel(CHANNEL);
}

/**
 * The site's end: opened at the press, told the commit after the save.
 *
 * `opened` is false when the browser refused the tab. The handoff still works
 * then -- a tab opened later from `url` finds the commit here -- which is what
 * the "Open the Studio to publish" button does.
 */
export type SiteHandoff = {
  id: string;
  url: string;
  opened: boolean;
  /** Hand the tab the commit to build. Re-sent whenever a tab says it is ready. */
  commit: (payload: Extract<ToTab, { type: "commit" }>) => void;
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
  const open =
    options.open ?? ((u: string, target: string) => window.open(u, target));
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
      // A tab that came up after the commit was sent asks for it again.
      if (message.type === "ready" && pending !== null) send(pending);
      for (const listener of listeners) listener(message);
    };
  }
  return {
    id,
    url,
    opened,
    commit: (payload) => {
      pending = payload;
      send(payload);
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
 * The tab's end: ask for the commit, then report.
 *
 * `ready` is repeated until the commit arrives, because the site may not have
 * one yet -- the save runs after the tab opens -- and a message sent before
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
  if (message.type === "commit" && "commit" in message) {
    const commit = typeof message.commit === "string" ? message.commit : null;
    const branch =
      "branch" in message && typeof message.branch === "string"
        ? message.branch
        : null;
    const binaryFiles =
      "binaryFiles" in message ? asBinaryFiles(message.binaryFiles) : null;
    return { type: "commit", commit, branch, binaryFiles };
  }
  return null;
}

function asBinaryFiles(value: unknown): CommittedBinaryFiles | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("files" in value) ||
    typeof value.files !== "object" ||
    value.files === null
  ) {
    return null;
  }
  const files: Record<string, string> = {};
  for (const [path, base64] of Object.entries(value.files)) {
    if (typeof base64 === "string") files[path] = base64;
  }
  const unread =
    "unread" in value && Array.isArray(value.unread)
      ? value.unread.filter((path): path is string => typeof path === "string")
      : [];
  return { files, unread };
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

function asResult(value: unknown): StudioDeployResult | null {
  if (typeof value !== "object" || value === null || !("status" in value))
    return null;
  const url =
    "url" in value && typeof value.url === "string" ? value.url : null;
  if (value.status === "live") {
    const visible =
      "visible" in value && typeof value.visible === "boolean"
        ? value.visible
        : undefined;
    return visible === undefined
      ? { status: "live", url }
      : { status: "live", url, visible };
  }
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
