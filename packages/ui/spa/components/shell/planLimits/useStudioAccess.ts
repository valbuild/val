import { useCallback, useEffect, useRef, useState } from "react";
import { onPlanRefusal, type PlanRefusal } from "../../../utils/planRefusal";
import { ADMIN_PROXY } from "../ProjectSwitcher";
import { orgOfProject } from "../ProjectMembersButton";
import {
  parseStudioAccess,
  STORAGE_METERS,
  type FetchAnswer,
  type StudioAccess,
} from "./studioAccess";

export type StudioAccessState = {
  /**
   * Val Build's answer. Null until it answers, and for a project that is not
   * connected; a failed ask keeps the answer before it (or null), because the
   * write itself is refused with the reason, and a notice that guesses is
   * worse than none.
   */
  access: StudioAccess | null;
  /** The last write Val Build refused for the plan, as its 403 said it. */
  refusal: PlanRefusal | null;
  /**
   * Ask again: a write was refused, and `/access` says what is true now.
   * Calls close together are one request.
   */
  refresh: () => void;
  /** Put the refusal away: its notice was dismissed. */
  clearRefusal: () => void;
};

/** Refreshes this close together are one request, at the end of the window. */
export const REFRESH_WINDOW_MS = 2000;
/**
 * Coming back to the Studio asks again, at most this often: an owner who
 * added a card in Billing comes back to a Studio that knows. Not on every
 * focus -- on Free, `/access` takes Val Build's change-count lock.
 */
export const FOCUS_REFRESH_MS = 60_000;
/** A moment the answer names is asked about no sooner than this from now. */
export const MIN_SCHEDULED_REFRESH_MS = 30_000;
/** And no later than this, so a long timer is re-armed rather than overflowing. */
export const MAX_SCHEDULED_REFRESH_MS = 6 * 60 * 60_000;
/** Asked a little after the moment, so Val Build is past it too. */
const SCHEDULE_GRACE_MS = 5_000;

/**
 * The soonest moment the answer (or a stored refusal) names at which it will
 * change by itself: Free's next change, a refused write's `until`, a trial's
 * end or the day its site pauses, a Hosted month's reset. Null when nothing
 * is due. Past moments are left out: the answer that named them is already
 * the one after.
 */
export function nextChangeAt(
  access: StudioAccess | null,
  refusal: PlanRefusal | null,
  now: number,
): number | null {
  const limits = access?.limits ?? null;
  const trial = limits?.trial ?? null;
  const candidates = [
    limits?.changes?.nextAt ?? null,
    limits?.refused.edit?.until ?? null,
    limits?.refused.publish?.until ?? null,
    limits?.refused.remoteFiles?.until ?? null,
    trial?.status === "running" || trial?.status === "running-with-card"
      ? trial.endsAt
      : null,
    trial?.status === "over" ? trial.pauseAt : null,
    limits?.usage !== null &&
    limits?.usage !== undefined &&
    (limits.usage.out.length > 0 || limits.usage.warn.length > 0)
      ? limits.usage.resetsAt
      : null,
    refusal?.until ?? null,
  ]
    .filter((iso): iso is string => iso !== null)
    .map((iso) => Date.parse(iso))
    .filter((at) => Number.isFinite(at) && at > now);
  return candidates.length === 0 ? null : Math.min(...candidates);
}

/** How long to wait to ask about `at`, clamped to something sensible. */
export function scheduledDelay(at: number, now: number): number {
  return Math.min(
    Math.max(at - now + SCHEDULE_GRACE_MS, MIN_SCHEDULED_REFRESH_MS),
    MAX_SCHEDULED_REFRESH_MS,
  );
}

/**
 * Whether a fresh answer still refuses the write a stored 403 was about. A
 * refusal it no longer backs -- the owner upgraded, a week rolled over --
 * goes, rather than staying until someone dismisses it.
 */
export function refusalStillTrue(
  access: StudioAccess,
  refusal: PlanRefusal,
): boolean {
  const refused = access.limits?.refused ?? {};
  switch (refusal.code) {
    case "read-only":
    case "payment-failed":
      return access.plan?.access === "read-only" || refused.edit !== undefined;
    case "trial-publishes":
      return refused.publish !== undefined;
    case "plan:remote-files":
      return refused.remoteFiles !== undefined;
    case "usage:storage":
      // `/access` does not refuse uploads for usage itself today; a storage
      // meter that is out is the same fact.
      return (
        refused.remoteFiles !== undefined ||
        (access.limits?.usage?.out ?? []).some((meter) =>
          STORAGE_METERS.includes(meter),
        )
      );
    case "limit:changes":
    case "trial-over":
      return refused.edit !== undefined;
    case "other":
      // Which write it was about is not known: it stays while anything is.
      return (
        access.plan?.access === "read-only" || Object.keys(refused).length > 0
      );
  }
}

/**
 * Whether this project's Studio can edit, and what its plan allows, asked of
 * Val Build through this app's proxy. Asked on load; again when a write is
 * refused; when the Studio is come back to (at most once a minute); and at
 * the next moment the answer itself says it will change. One request feeds
 * every notice and the top bar's status.
 */
export function useStudioAccess(
  projectName: string | undefined,
  fetchImpl: FetchAnswer = fetch,
): StudioAccessState {
  const [access, setAccess] = useState<StudioAccess | null>(null);
  const [refusal, setRefusal] = useState<PlanRefusal | null>(null);
  const [asked, setAsked] = useState(0);
  const org = projectName === undefined ? null : orgOfProject(projectName);
  const name = projectName?.split("/")[1];
  const connected = org !== null && name !== undefined;
  /** Bumped by every refusal: an answer asked for before it cannot clear it. */
  const refusalEpoch = useRef(0);
  /** When `/access` was last asked, by anything. */
  const lastFetchAt = useRef(0);

  useEffect(() => {
    if (org === null || name === undefined) return;
    const controller = new AbortController();
    const epoch = refusalEpoch.current;
    lastFetchAt.current = Date.now();
    fetchImpl(
      `${ADMIN_PROXY}/orgs/${encodeURIComponent(org)}/projects/${encodeURIComponent(name)}/access`,
      { headers: { "x-val-studio": "1" }, signal: controller.signal },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((json: unknown) => {
        const parsed = parseStudioAccess(json);
        // A failed refresh keeps what was known: the plan did not change
        // because one request did not come back.
        if (parsed !== null || json !== null) setAccess(parsed);
        if (parsed !== null && epoch === refusalEpoch.current) {
          setRefusal((stored) =>
            stored !== null && !refusalStillTrue(parsed, stored)
              ? null
              : stored,
          );
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [org, name, fetchImpl, asked]);

  const lastAskedAt = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pending.current !== null) clearTimeout(pending.current);
    },
    [],
  );
  const refresh = useCallback(() => {
    if (pending.current !== null) return;
    const wait = lastAskedAt.current + REFRESH_WINDOW_MS - Date.now();
    const ask = () => {
      pending.current = null;
      lastAskedAt.current = Date.now();
      setAsked((n) => n + 1);
    };
    if (wait <= 0) ask();
    else pending.current = setTimeout(ask, wait);
  }, []);

  useEffect(
    () =>
      onPlanRefusal((next) => {
        refusalEpoch.current++;
        setRefusal(next);
        refresh();
      }),
    [refresh],
  );

  // Back to the Studio: the fix is usually made in another tab.
  useEffect(() => {
    if (!connected) return;
    const onReturn = () => {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - lastFetchAt.current < FOCUS_REFRESH_MS) return;
      refresh();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [connected, refresh]);

  // The next moment the answer says it will change by itself.
  useEffect(() => {
    if (!connected) return;
    const now = Date.now();
    const at = nextChangeAt(access, refusal, now);
    if (at === null) return;
    const timer = setTimeout(refresh, scheduledDelay(at, now));
    return () => clearTimeout(timer);
  }, [connected, access, refusal, refresh]);

  const clearRefusal = useCallback(() => setRefusal(null), []);
  return { access, refusal, refresh, clearRefusal };
}
