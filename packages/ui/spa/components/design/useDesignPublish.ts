import { useCallback, useEffect, useMemo, useState } from "react";
import {
  usePublishSummary,
  useProposalPublish,
  useSiteHandoffState,
} from "../ValProvider";
import type { PublishProposalState } from "../proposals/PublishProposalDialog";
import { mergeNeedsBuild } from "../../proposals/mergeNeedsBuild";
import type {
  ProposalJson,
  ProposalsClient,
} from "../../proposals/proposalsClient";

/**
 * Publish from the design tab: the proposal merged into the site, as its own
 * Studio's Publish does it (valbuild/home `docs/design-tab.md`).
 *
 * The same press and the same tracker -- `publishProposal` names the proposal
 * it merges, and `useProposalPublish` follows it -- so a merge pressed here is
 * built by this tab, or the builder tab, like any other. What the tab has
 * none of is unsaved content: it changes code, which is staged as it is
 * written, so there is nothing to save first.
 *
 * The checks are content's, read through the site's server: the moves Val
 * works out at a proposal's own address (which of the site's pending changes
 * the merge takes along) are not offered here, so the site's pending changes
 * block as they do from the site.
 */
export function useDesignPublish(
  name: string,
  proposal: ProposalJson | null,
  client: Pick<ProposalsClient, "mergeChecks">,
): {
  open: boolean;
  setOpen: (open: boolean) => void;
  state: PublishProposalState;
  publish: () => void;
  retry: () => void;
} {
  const [open, setOpenState] = useState(false);
  const [state, setState] = useState<PublishProposalState>({
    kind: "checking",
  });
  const { publishProposal } = usePublishSummary();
  const tracked = useProposalPublish(name);
  const handoff = useSiteHandoffState().state;
  /** When Publish was pressed: only a request pressed since is this one. */
  const [pressedAt, setPressedAt] = useState<number | null>(null);

  const loadChecks = useCallback(async () => {
    setState({ kind: "checking" });
    try {
      const { checks } = await client.mergeChecks(name);
      setState({
        kind: "ready",
        checks,
        changes: proposal?.changes ?? 0,
        unsaved: 0,
      });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [client, name, proposal?.changes]);

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      if (next && pressedAt === null) void loadChecks();
    },
    [loadChecks, pressedAt],
  );

  const publish = useCallback(() => {
    const since = Date.now();
    setPressedAt(since);
    setState({ kind: "publishing", step: "building" });
    void publishProposal(name, { needsBuild: mergeNeedsBuild(proposal) }).then(
      (answer) => {
        if (answer.status === "error") {
          setPressedAt(null);
          setState({ kind: "failed", message: answer.message });
        }
      },
    );
  }, [name, proposal, publishProposal]);

  // Where the press is, from the tracker, once it says.
  const following = useMemo<PublishProposalState | null>(() => {
    if (pressedAt === null) return null;
    const request =
      tracked !== null && tracked.request.pressedAt >= pressedAt
        ? tracked.request
        : null;
    if (request === null) {
      if (handoff?.kind === "blocked") {
        return {
          kind: "failed",
          message:
            "This browser did not open the tab the publish is built in, so nothing was published. Press Try again: it opens the tab.",
        };
      }
      if (handoff?.kind === "failed") {
        return { kind: "failed", message: handoff.message };
      }
      return { kind: "publishing", step: "building" };
    }
    switch (request.status.kind) {
      case "live":
        return { kind: "merged" };
      case "failed":
        return { kind: "failed", message: request.status.message };
      case "cancelled":
        return {
          kind: "failed",
          message: "It was stopped before it reached the site.",
        };
      case "nothing-to-publish":
        return { kind: "failed", message: "There was nothing to publish." };
      case "queued":
      case "publishing":
        return {
          kind: "publishing",
          step:
            request.handedOffAt !== undefined || handoff?.kind === "checking"
              ? "publishing"
              : "building",
        };
    }
  }, [pressedAt, tracked, handoff]);

  // Settled: the dialog keeps the outcome, and stops following.
  useEffect(() => {
    if (following === null || following.kind === "publishing") return;
    setPressedAt(null);
    setState(following);
  }, [following]);

  return {
    open,
    setOpen,
    state: following ?? state,
    publish,
    retry: () => {
      if (state.kind === "error") void loadChecks();
      else publish();
    },
  };
}
