import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createProposalsClient,
  meansNoProposals,
  type ProposalJson,
  type ProposalsClient,
} from "./proposalsClient";

/**
 * The project's proposals, and the one this Studio is in, as the switcher,
 * the bar and the list read them. valbuild/home `docs/proposals.md`, Flow B.
 *
 * `off` is the answer for a project that has none here -- proposals turned
 * off, or a server with no content service -- and then nothing about
 * proposals is shown at all, so a project nobody opted in sees no change.
 * A Studio IN a proposal is never `off`: its server said so on `/stat`.
 */
export type ProposalsState =
  | { status: "off" }
  | { status: "loading" }
  | {
      status: "ready";
      /** Every proposal, newest first: the list has tabs for each status. */
      proposals: ProposalJson[];
      /** Where "The site" goes. `null` when the project has not said. */
      siteUrl: string | null;
      /**
       * The proposal this Studio is in, read on its own: only that answer
       * carries its overlay and render check.
       */
      current: ProposalJson | null;
      /** Why the last refresh failed, while the last good answer is shown. */
      error: string | null;
    };

/** How often to look again while one of the current proposal's jobs runs. */
const WHILE_WORKING_MS = 2000;

export function useProposals({
  enabled,
  current,
  client: givenClient,
}: {
  /** False where there can be no proposals (`fs` mode, before a stat). */
  enabled: boolean;
  /** The proposal this Studio is in, by name; `null` on the site. */
  current: string | null;
  client?: ProposalsClient;
}): {
  state: ProposalsState;
  client: ProposalsClient;
  /** Ask again, after something changed. */
  refresh: () => Promise<void>;
} {
  const client = useMemo(
    () => givenClient ?? createProposalsClient({ api: "/api/val" }),
    [givenClient],
  );
  const [state, setState] = useState<ProposalsState>(
    enabled || current !== null ? { status: "loading" } : { status: "off" },
  );
  /*
   * Answers can land out of order -- a poll and a refresh after a rename --
   * and only the newest request's answer is kept.
   */
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!enabled && current === null) {
      setState({ status: "off" });
      return;
    }
    const mine = ++generation.current;
    const [list, one] = await Promise.allSettled([
      client.list(),
      current === null ? Promise.resolve(null) : client.get(current),
    ]);
    if (mine !== generation.current) return;
    if (list.status === "rejected" && current === null) {
      if (meansNoProposals(list.reason)) {
        setState({ status: "off" });
        return;
      }
    }
    setState((before) => {
      const previous = before.status === "ready" ? before : null;
      const failure =
        list.status === "rejected"
          ? list.reason
          : one.status === "rejected"
            ? one.reason
            : null;
      return {
        status: "ready",
        proposals:
          list.status === "fulfilled"
            ? list.value.proposals
            : (previous?.proposals ?? []),
        siteUrl:
          list.status === "fulfilled"
            ? list.value.siteUrl
            : (previous?.siteUrl ?? null),
        current:
          one.status === "fulfilled" ? one.value : (previous?.current ?? null),
        error:
          failure === null
            ? null
            : failure instanceof Error
              ? failure.message
              : String(failure),
      };
    });
  }, [client, enabled, current]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /*
   * Another tab or person may have opened, renamed or closed one. Only where
   * there are proposals: a project without them is asked once, not on every
   * return to the tab.
   */
  const hasProposals = state.status === "ready";
  useEffect(() => {
    if (!hasProposals) return;
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [hasProposals, refresh]);

  // Following the current proposal's jobs: setup, the overlay, the render check.
  const working =
    state.status === "ready" &&
    state.current !== null &&
    [
      state.current.setup,
      state.current.overlay,
      state.current.renderCheck,
    ].some((job) => job?.status === "pending" || job?.status === "running");
  useEffect(() => {
    if (!working) return;
    const timer = window.setTimeout(() => void refresh(), WHILE_WORKING_MS);
    return () => window.clearTimeout(timer);
  }, [working, refresh, state]);

  return { state, client, refresh };
}

/**
 * Wait until a proposal can be opened: its setup has given it an address.
 * Resolves with the address, or rejects with why it cannot be opened.
 */
export async function waitForAddress(
  client: ProposalsClient,
  name: string,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<string> {
  const intervalMs = options.intervalMs ?? 1000;
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  for (;;) {
    const proposal = await client.get(name);
    if (proposal.address) return proposal.address;
    if (proposal.setup?.status === "failed") {
      throw new Error(
        `The proposal could not be set up${
          proposal.setup.lastError ? `: ${proposal.setup.lastError}` : "."
        }`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        "The proposal is still being set up. Open it from the list in a moment.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
