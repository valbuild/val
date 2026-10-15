import { useCallback, useEffect, useRef, useState } from "react";
import { onPlanRefusal, type PlanRefusal } from "../../../utils/planRefusal";
import { ADMIN_PROXY } from "../ProjectSwitcher";
import { orgOfProject } from "../ProjectMembersButton";
import {
  parseStudioAccess,
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
 * Whether this project's Studio can edit, and what its plan allows, asked of
 * Val Build through this app's proxy: once on load, and again whenever a
 * write is refused. One request feeds every notice and the top bar's status.
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

  useEffect(() => {
    if (org === null || name === undefined) return;
    const controller = new AbortController();
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
        setRefusal(next);
        refresh();
      }),
    [refresh],
  );

  const clearRefusal = useCallback(() => setRefusal(null), []);
  return { access, refusal, refresh, clearRefusal };
}
