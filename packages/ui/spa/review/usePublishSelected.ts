import { useCallback, useEffect, useMemo, useState } from "react";
import type { PatchId } from "@valbuild/core";
import {
  useProposalPublish,
  usePublishSummary,
} from "../components/ValProvider";
import { useSavePatches } from "../history/useLandRestore";
import {
  createProposalsClient,
  sameStudioPageAt,
} from "../proposals/proposalsClient";
import { waitForAddress } from "../proposals/useProposals";
import { goToProposal } from "../proposals/proposalHandoff";
import { randomUUID } from "../utils/randomUUID";
import {
  publishSelectedClient,
  publishSelectedName,
  runPublishSelected,
} from "./publishSelected";

/** Where a Publish selected is, for the bar in Review to show. */
export type PublishSelectedState =
  | { kind: "idle" }
  | { kind: "publishing"; count: number }
  | { kind: "published"; count: number }
  | {
      kind: "failed";
      count: number;
      message: string;
      /** The proposal the changes are safe in, when they got that far. */
      proposal: string | null;
      /** Whether Try again can help: false where nothing it does would change. */
      canRetry: boolean;
    };

type Press = {
  patchIds: PatchId[];
  requestId: string;
  proposal: string | null;
  /** When the proposal's merge was pressed: its tracked publish is newer. */
  since: number;
};

/**
 * Publish selected, as Review's bar uses it: press, follow the proposal's
 * merge to Live through the same tracker every publish goes through, and on a
 * failure offer what can help -- Try again, and Open the proposal once the
 * changes are in one. See `publishSelected.ts` for the steps.
 */
export function usePublishSelected(): {
  state: PublishSelectedState;
  publish: (patchIds: PatchId[]) => void;
  retry: () => void;
  openProposal: () => void;
  dismiss: () => void;
} {
  const save = useSavePatches();
  const { publishProposal, retryProposalPublish } = usePublishSummary();
  const [press, setPress] = useState<Press | null>(null);
  const [state, setState] = useState<PublishSelectedState>({ kind: "idle" });
  const tracked = useProposalPublish(press?.proposal ?? null);
  const move = useMemo(() => publishSelectedClient({ api: "/api/val" }), []);

  const run = useCallback(
    async (next: Press) => {
      setPress(next);
      setState({ kind: "publishing", count: next.patchIds.length });
      const since = Date.now();
      const result = await runPublishSelected({
        save,
        move,
        // Content only, always: a `publish` proposal stages no code.
        publish: (proposal) => publishProposal(proposal, { needsBuild: false }),
        patchIds: next.patchIds,
        displayName: publishSelectedName(next.patchIds.length, new Date()),
        requestId: next.requestId,
        ...(next.proposal !== null ? { proposal: next.proposal } : {}),
      });
      if (result.status === "error") {
        setPress({ ...next, proposal: result.proposal });
        setState({
          kind: "failed",
          count: next.patchIds.length,
          message: result.message,
          proposal: result.proposal,
          canRetry: result.canRetry,
        });
        return;
      }
      setPress({ ...next, proposal: result.proposal, since });
    },
    [move, publishProposal, save],
  );

  // The merge, followed: what the tracker says of the press made since.
  const request =
    press !== null &&
    tracked !== null &&
    tracked.request.pressedAt >= press.since
      ? tracked.request
      : null;
  useEffect(() => {
    if (press === null || request === null) return;
    const count = press.patchIds.length;
    switch (request.status.kind) {
      case "live":
        setState({ kind: "published", count });
        return;
      case "failed":
        /*
         * What content says can be done, and where the changes are: a merge
         * that broke the site moves them on into a proposal of their own
         * (`movedTo`), which is then the one to open, and there is nothing
         * to try again here.
         */
        setState({
          kind: "failed",
          count,
          message: request.status.message,
          proposal: request.status.movedTo?.proposal ?? press.proposal,
          canRetry: request.status.actions.includes("try-again"),
        });
        return;
      case "cancelled":
        setState({
          kind: "failed",
          count,
          message: "The publish was stopped before it reached the site.",
          proposal: press.proposal,
          canRetry: true,
        });
        return;
      case "nothing-to-publish":
        setState({
          kind: "failed",
          count,
          message: "There was nothing to publish.",
          proposal: press.proposal,
          canRetry: false,
        });
        return;
      case "queued":
      case "publishing":
        setState({ kind: "publishing", count });
    }
  }, [press, request]);

  const publish = useCallback(
    (patchIds: PatchId[]) => {
      void run({
        patchIds,
        requestId: `publish-${randomUUID()}`,
        proposal: null,
        since: Number.POSITIVE_INFINITY,
      });
    },
    [run],
  );

  const retry = useCallback(() => {
    if (press === null) return;
    // A merge that failed is tried again as itself; anything earlier, anew.
    if (
      press.proposal !== null &&
      request !== null &&
      request.status.kind === "failed"
    ) {
      const since = Date.now();
      setPress({ ...press, since });
      setState({ kind: "publishing", count: press.patchIds.length });
      void retryProposalPublish(press.proposal, request.requestId, {
        needsBuild: false,
      }).then((answer) => {
        if (answer.status === "error") {
          setState({
            kind: "failed",
            count: press.patchIds.length,
            message: answer.message,
            proposal: press.proposal,
            canRetry: true,
          });
        }
      });
      return;
    }
    void run({ ...press, since: Number.POSITIVE_INFINITY });
  }, [press, request, retryProposalPublish, run]);

  const openProposal = useCallback(() => {
    const proposal = press?.proposal;
    if (proposal === null || proposal === undefined) return;
    const client = createProposalsClient({ api: "/api/val" });
    void waitForAddress(client, proposal)
      .then((origin) =>
        goToProposal(proposal, sameStudioPageAt(origin, window.location)),
      )
      .catch((error: unknown) => {
        setState((current) =>
          current.kind === "failed"
            ? {
                ...current,
                message: error instanceof Error ? error.message : String(error),
              }
            : current,
        );
      });
  }, [press?.proposal]);

  const dismiss = useCallback(() => {
    setPress(null);
    setState({ kind: "idle" });
  }, []);

  return { state, publish, retry, openProposal, dismiss };
}
