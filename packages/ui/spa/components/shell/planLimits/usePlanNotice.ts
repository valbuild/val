import { useCallback, useEffect, useMemo, useState } from "react";
import { planNoticesOf, type PlanNotice } from "./planNotices";
import { planStatusOf, type PlanStatus } from "./planStatus";
import type { StudioAccessState } from "./useStudioAccess";

/** How often the notices' times are read again: "today at", "until 22 October". */
export const CLOCK_TICK_MS = 60_000;

/**
 * The time, as state, moved on every minute: the notices say "today at
 * 14:20" and "keeps running until 22 October", and a moment captured once
 * at the answer would keep saying them after they stopped being true.
 */
export function useNow(tickMs: number = CLOCK_TICK_MS): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), tickMs);
    return () => clearInterval(timer);
  }, [tickMs]);
  return now;
}

export type PlanNoticeState = {
  /** The one notice to show now, or null. */
  notice: PlanNotice | null;
  /** Put it away, when it can be (`PlanNotice.dismiss`). */
  dismiss: (notice: PlanNotice) => void;
  /** The top bar's status, or null. */
  status: PlanStatus | null;
};

/**
 * What the shell shows of the plan: the most pressing notice that has not
 * been put away, and the top bar's status. One at a time -- two cards about
 * the plan above the editor would be read as two problems.
 */
export function usePlanNotice(
  state: StudioAccessState,
  context: {
    /** The project's own name: `website` of `acme/website`; null if unknown. */
    project: string | null;
    changesWaiting?: number;
  },
): PlanNoticeState {
  const { access, refusal, clearRefusal } = state;
  const { project, changesWaiting } = context;
  const now = useNow();
  const notices = useMemo(
    () =>
      planNoticesOf(access, refusal, {
        project,
        changesWaiting,
        now,
      }),
    [access, refusal, project, changesWaiting, now],
  );
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const notice =
    notices.find(
      (candidate) =>
        !(candidate.dismiss === "session" && dismissed.has(candidate.id)),
    ) ?? null;
  const dismiss = useCallback(
    (notice: PlanNotice) => {
      if (notice.dismiss === "refusal") clearRefusal();
      if (notice.dismiss === "session") {
        setDismissed((previous) => new Set([...previous, notice.id]));
      }
    },
    [clearRefusal],
  );
  const status = useMemo(
    () => planStatusOf(access, project),
    [access, project],
  );
  return { notice, dismiss, status };
}
