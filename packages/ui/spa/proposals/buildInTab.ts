import {
  openBuilderWindow,
  openHandoff,
  type HandedProposalBuild,
  type HandedQuickPreview,
  type SiteHandoff,
} from "../publish/handoff";
import { BUILD_CANCELLED_MESSAGE } from "@valbuild/shared/publish";
import type { ProposalBuildOutcome } from "./proposalCode";
import type { ProposalsClient } from "./proposalsClient";

/** The builder tab a build was handed to, while it runs. */
let handoff: SiteHandoff | null = null;
/** That tab has not been let open: see `openBuilder`. */
let blocked = false;
/**
 * A quick preview's builder tab, apart from a build's: the two can be under
 * way at once (the assistant's `build_proposal` and `quick_preview`), and
 * each has its own tab to open from a tap.
 */
let quickHandoff: SiteHandoff | null = null;
let quickBlocked = false;

/** How long a tab may say nothing before the page asks content how it ended. */
export const TAB_SILENT_MS = 15_000;
/** How long a tab that never said anything is waited for, at all. */
export const TAB_NEVER_HEARD_MS = 5 * 60_000;
export const TAB_GONE_MESSAGE =
  "The tab building the proposal stopped before it finished, so it was not built. Press Build to build it again.";
export const NOT_STORED_BUILD_MESSAGE =
  "This browser would not let Val hand the build to a new tab, so nothing was built. Allow site data for this site, or leave private browsing, then press Build again.";

/**
 * Build the proposal in a builder tab (`HandoffProposalBuildTab`), and follow
 * it to the end.
 *
 * The tab opens here, in the tap, and stores what it is to do first -- the
 * same hand-off a publish uses (`publish/handoff.ts`). On an iPhone the tab
 * takes the screen and this page is paused until it is back, so the tab's
 * last word may never arrive: a tab that has gone quiet is not taken as a
 * failure until content says the proposal is still not built.
 */
export function buildInTab(
  name: string,
  proposals: Pick<ProposalsClient, "get">,
  deps: {
    open?: (url: string, target: string) => unknown;
    storage?: Storage | null;
    /** The tab's state, for the Build button: see `ProposalBuildState.inTab`. */
    onTab: (
      inTab: {
        blocked: boolean;
        step: string | null;
        percent?: number | null;
      } | null,
    ) => void;
    now?: () => number;
    every?: (tick: () => void, ms: number) => () => void;
    /** Cancel: the tab is closed, which stops the build in it. */
    signal?: AbortSignal;
  },
): Promise<ProposalBuildOutcome> {
  const now = deps.now ?? Date.now;
  const every =
    deps.every ??
    ((tick, ms) => {
      const timer = setInterval(tick, ms);
      return () => clearInterval(timer);
    });
  return new Promise((resolve) => {
    const tab = openHandoff({
      intent: { kind: "build-proposal", name },
      ...(deps.open ? { open: deps.open } : {}),
      ...(deps.storage !== undefined ? { storage: deps.storage } : {}),
    });
    if (!tab.stored) {
      tab.close();
      resolve({ status: "failed", message: NOT_STORED_BUILD_MESSAGE });
      return;
    }
    handoff = tab;
    blocked = !tab.opened;
    deps.onTab({ blocked, step: null });
    const openedAt = now();
    let heard = false;
    let lastHeard = openedAt;
    let ended = false;
    const finish = (outcome: ProposalBuildOutcome) => {
      if (ended) return;
      ended = true;
      stop();
      off();
      tab.close();
      if (handoff === tab) handoff = null;
      deps.onTab(null);
      deps.signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    // A watchdog's stop carries why (the step that stalled); a cancel does not.
    const onAbort = () => {
      const reason: unknown = deps.signal?.reason;
      finish(
        reason instanceof Error && reason.name !== "AbortError"
          ? { status: "failed", message: reason.message }
          : {
              status: "failed",
              message: BUILD_CANCELLED_MESSAGE,
              cancelled: true,
            },
      );
    };
    const builtNow = async (): Promise<ProposalBuildOutcome | null> => {
      try {
        const proposal = await proposals.get(name);
        return proposal.staged?.buildRequired === false && proposal.built?.hash
          ? { status: "built", hash: proposal.built.hash, proposal }
          : null;
      } catch {
        return null;
      }
    };
    const off = tab.onMessage((message) => {
      heard = true;
      lastHeard = now();
      if (message.type === "phase") {
        blocked = false;
        deps.onTab({
          blocked: false,
          step: message.label,
          percent: message.percent ?? null,
        });
      } else if (message.type === "proposal-built") {
        void outcomeOf(message.outcome, name, proposals).then(finish);
      }
    });
    let checking = false;
    const stop = every(() => {
      if (ended || checking || blocked) return;
      const quiet = now() - lastHeard;
      if (quiet < TAB_SILENT_MS) return;
      if (!heard && now() - openedAt < TAB_NEVER_HEARD_MS) return;
      checking = true;
      void builtNow().then((built) => {
        checking = false;
        if (built !== null) finish(built);
        else if (heard || now() - openedAt >= TAB_NEVER_HEARD_MS)
          finish({ status: "failed", message: TAB_GONE_MESSAGE });
      });
    }, 5_000);
    // Last, once everything `finish` stops exists.
    if (deps.signal?.aborted) onAbort();
    else deps.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** What the page makes of the tab's outcome: a build reads the proposal back. */
async function outcomeOf(
  handed: HandedProposalBuild,
  name: string,
  proposals: Pick<ProposalsClient, "get">,
): Promise<ProposalBuildOutcome> {
  if (handed.status !== "built") return handed;
  try {
    return { ...handed, proposal: await proposals.get(name) };
  } catch (error) {
    return {
      status: "failed",
      message: `Built, but the proposal could not be read back: ${
        error instanceof Error ? error.message : String(error)
      }. Press Build to check again.`,
    };
  }
}

/**
 * Open the builder tab the browser did not let open -- from a tap, which it
 * allows. The same id, so the tab finds the intent stored for it. Whether it
 * opened.
 */
export function openBuilder(
  open: (url: string, target: string) => unknown = openBuilderWindow,
): boolean {
  // A build's tab first, then a quick preview's: one tap opens one tab.
  if (handoff !== null && blocked) {
    const opened = open(handoff.url, `val-publish-${handoff.id}`) !== null;
    if (opened) blocked = false;
    return opened;
  }
  if (quickHandoff !== null && quickBlocked) {
    const opened =
      open(quickHandoff.url, `val-publish-${quickHandoff.id}`) !== null;
    if (opened) quickBlocked = false;
    return opened;
  }
  const tab = handoff ?? quickHandoff;
  if (tab === null) return false;
  return open(tab.url, `val-publish-${tab.id}`) !== null;
}

/** How long a quick preview's builder tab may say nothing before it is given up on. */
export const QUICK_PREVIEW_TAB_SILENT_MS = 20_000;
export const QUICK_PREVIEW_TAB_GONE_MESSAGE =
  "The tab preparing the quick preview stopped before it finished. Press Quick preview to try again.";

/**
 * Bundle a quick preview in a builder tab (`HandoffQuickPreviewTab`), for a
 * design tab that cannot build itself: Safari, an iPhone. The same hand-off
 * as {@link buildInTab}, and the same blocked tab -- {@link openBuilder}
 * opens it from a tap -- and the files come back over it.
 */
export function quickPreviewInTab(
  name: string,
  deps: {
    open?: (url: string, target: string) => unknown;
    storage?: Storage | null;
    /** The tab's state: see `buildInTab`'s `onTab`. */
    onTab: (inTab: { blocked: boolean; step: string | null } | null) => void;
    now?: () => number;
    every?: (tick: () => void, ms: number) => () => void;
  },
): Promise<HandedQuickPreview> {
  const now = deps.now ?? Date.now;
  const every =
    deps.every ??
    ((tick, ms) => {
      const timer = setInterval(tick, ms);
      return () => clearInterval(timer);
    });
  return new Promise((resolve) => {
    const tab = openHandoff({
      intent: { kind: "quick-preview", name },
      ...(deps.open ? { open: deps.open } : {}),
      ...(deps.storage !== undefined ? { storage: deps.storage } : {}),
    });
    if (!tab.stored) {
      tab.close();
      resolve({ status: "failed", message: NOT_STORED_BUILD_MESSAGE });
      return;
    }
    quickHandoff = tab;
    quickBlocked = !tab.opened;
    deps.onTab({ blocked: quickBlocked, step: null });
    const openedAt = now();
    let lastHeard = openedAt;
    let ended = false;
    const finish = (outcome: HandedQuickPreview) => {
      if (ended) return;
      ended = true;
      stop();
      off();
      tab.close();
      if (quickHandoff === tab) {
        quickHandoff = null;
        quickBlocked = false;
      }
      deps.onTab(null);
      resolve(outcome);
    };
    const off = tab.onMessage((message) => {
      lastHeard = now();
      if (message.type === "phase") {
        quickBlocked = false;
        deps.onTab({ blocked: false, step: message.label });
      } else if (message.type === "quick-preview-built") {
        finish(message.outcome);
      }
    });
    const stopTicking = every(() => {
      if (ended) return;
      // A tab never let open waits for the tap, and its quiet counts from
      // when it was let open; one that went quiet after that is gone.
      if (quickBlocked) {
        lastHeard = now();
        return;
      }
      if (now() - lastHeard > QUICK_PREVIEW_TAB_SILENT_MS) {
        finish({ status: "failed", message: QUICK_PREVIEW_TAB_GONE_MESSAGE });
      }
    }, 2_000);
    /*
     * On an iPhone the builder tab takes the screen and this page is paused
     * until it is back: the tab's last word is waiting in this page's queue
     * then, behind the timer. Back on screen, it is given time to arrive
     * before the quiet counts.
     */
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        lastHeard = now();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
    const stop = () => {
      stopTicking();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  });
}
