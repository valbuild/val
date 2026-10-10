import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { TopBarProposals } from "../shell/TopBar";
import {
  useCurrentAuthorId,
  useCurrentProposal,
  useProfilesByAuthorId,
  usePublishSummary,
  useProposalPublish,
  useReportError,
  useSiteHandoffState,
  useValMode,
  type ProposalPublishPress,
} from "../ValProvider";
import { toast } from "../designSystem/sonner";
import { copyText } from "../../utils/copyText";
import {
  ProposalsApiError,
  jobState,
  sameStudioPageAt,
  toSummary,
  type ProposalJson,
} from "../../proposals/proposalsClient";
import { useProposals, waitForAddress } from "../../proposals/useProposals";
import {
  NewProposalDialog,
  type NewProposalProblem,
} from "./NewProposalDialog";
import { CloseProposalDialog } from "./CloseProposalDialog";
import { RenameProposalDialog } from "./RenameProposalDialog";
import {
  PublishProposalDialog,
  type PublishProposalState,
} from "./PublishProposalDialog";
import { followCarryOver, type CarryOver } from "../../proposals/carryOver";
import { canBuildHere } from "../../publish/handoff";
import { randomUUID } from "../../utils/randomUUID";
import { randomProposalName } from "../../proposals/proposalNames";
import { AllProposalsDialog } from "./ProposalsList";
import { MergedProposalNotice } from "./MergedProposalNotice";
import type { ProposalPerson, ProposalSummary, StudioLocation } from "./types";

/** Why Publish is not offered, by the proposal's status; null when it is. */
function publishBlockedByStatus(status: string | undefined): string | null {
  switch (status) {
    case "merging":
      return "It is being published to the site.";
    case "merged":
      return "It is published: this proposal is finished. Anything more starts a new one.";
    case "closed":
      return "It is closed. Reopen it from All proposals to publish it.";
    case "updating":
    case "needs-resolution":
      return "It is being brought up to date with the site.";
    default:
      return null;
  }
}

type Dialog = "new" | "close" | "rename" | "all" | "publish" | null;

/**
 * The proposals half of the Studio: what `TopBar` shows, from the content
 * service, and the dialogs it opens. `ValShell` passes both on.
 *
 * Going somewhere is NAVIGATING: a proposal is served at its own address, so
 * opening one -- or the site -- loads the Studio there, on the same page.
 * Saving is the Studio's own publish, which a proposal's server sends to the
 * proposal (`ValOpsHttp`'s commit), so it shares the patch handling, the
 * validation gate and the error reporting with Publish on the site.
 */
export function useProposalsBar({
  unsaved,
  portalContainer,
  onCompare,
}: {
  /** Changes made since the last save: the Save button's count. */
  unsaved: number;
  portalContainer?: HTMLElement | null;
  /** Compare with the site: what Publish would publish. */
  onCompare?: () => void;
}): {
  /** `undefined` where this project has no proposals. */
  proposals: TopBarProposals | undefined;
  dialogs: ReactNode;
  /** Above the editor, or null: a merged proposal says it is finished. */
  notice: ReactNode | null;
} {
  const mode = useValMode();
  const here = useCurrentProposal();
  const { state, client, refresh } = useProposals({
    enabled: mode === "http",
    current: here?.name ?? null,
  });
  const profiles = useProfilesByAuthorId();
  const viewer = useCurrentAuthorId();
  const reportError = useReportError();
  const { publish, isPublishing, publishProposal, retryProposalPublish } =
    usePublishSummary();

  const [dialog, setDialog] = useState<Dialog>(null);
  /*
   * One of each per opening of New proposal: pressing Create twice, or again
   * after an answer that was lost, is the same create, and so the same
   * proposal. Opening the dialog again is a new one.
   */
  const [newProposal, setNewProposal] = useState(nextNewProposal);
  const [busy, setBusy] = useState<"creating" | "closing" | "renaming" | null>(
    null,
  );
  const [newProblem, setNewProblem] = useState<NewProposalProblem | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [reopening, setReopening] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const people = useCallback(
    (id: string): ProposalPerson | null => {
      const profile = Object.entries(profiles).find(([key]) => key === id)?.[1];
      return profile
        ? {
            name: profile.fullName,
            ...(profile.avatar ? { avatarUrl: profile.avatar.url } : {}),
          }
        : null;
    },
    [profiles],
  );
  const ready = state.status === "ready" ? state : null;
  const all = useMemo(
    () => (ready?.proposals ?? []).map((p) => toSummary(p, viewer, people)),
    [ready?.proposals, viewer, people],
  );

  /** The proposal this Studio is in, as best known: its own read, or the list's. */
  const currentJson: ProposalJson | null =
    here === null
      ? null
      : (ready?.current ??
        ready?.proposals.find((p) => p.name === here.name) ??
        null);

  const go = useCallback((origin: string) => {
    window.location.assign(sameStudioPageAt(origin, window.location));
  }, []);

  const failed = useCallback(
    (what: string, error: unknown) =>
      reportError(what, error instanceof Error ? error.message : String(error)),
    [reportError],
  );

  const openProposal = useCallback(
    async (name: string) => {
      if (name === here?.name) return;
      const known = ready?.proposals.find((p) => p.name === name);
      try {
        if (known?.address) {
          go(known.address);
          return;
        }
        if (known?.setup?.status === "failed") {
          await client.retrySetup(name);
        }
        go(await waitForAddress(client, name));
      } catch (error) {
        failed("Could not open the proposal", error);
      }
    },
    [client, failed, go, here?.name, ready?.proposals],
  );

  const location: StudioLocation = useMemo(() => {
    if (here === null) return { kind: "site" };
    const proposal: ProposalSummary = currentJson
      ? toSummary(currentJson, viewer, people)
      : {
          // Its own read has not answered yet: the name is all there is.
          name: here.name,
          displayName: "Proposal",
          description: null,
          status: "open",
          owner: null,
          ownedByViewer: false,
          changes: 0,
          updatedAt: new Date(0).toISOString(),
        };
    return {
      kind: "proposal",
      proposal,
      unsaved,
      save: isPublishing
        ? { state: "saving" }
        : saveError !== null
          ? { state: "failed", error: saveError }
          : { state: "idle" },
      overlay: jobState(currentJson?.overlay),
      renderCheck: jobState(currentJson?.renderCheck),
      publishBlockedBy: publishBlockedByStatus(currentJson?.status),
    };
  }, [here, currentJson, viewer, people, unsaved, isPublishing, saveError]);

  /** Save; the reason it did not, or null when it did. */
  const save = useCallback(async (): Promise<string | null> => {
    setSaveError(null);
    const name = currentJson?.displayName ?? "the proposal";
    let failed: string | null = null;
    try {
      const result = await publish(`Saved in ${name}`);
      if (result.status === "refused" || result.status === "failed") {
        failed =
          "message" in result && typeof result.message === "string"
            ? result.message
            : "The save was refused";
      }
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error);
    } finally {
      void refresh();
    }
    setSaveError(failed);
    return failed;
  }, [currentJson?.displayName, publish, refresh]);

  /*
   * Publish: merging the proposal into the site (Flow F). The dialog reads
   * the merge checks first; the button saves anything unsaved, then presses
   * the merge -- a publish request like the site's, built and followed to
   * Live by the same tracker (`publishProposal`). This dialog only reads it.
   */
  const tracked = useProposalPublish(here?.name ?? null);
  const handoffState = useSiteHandoffState().state;
  const [publishState, setPublishState] = useState<PublishProposalState>({
    kind: "checking",
  });
  /**
   * Pressed, and not settled yet: from then the dialog follows the press --
   * the newest tracked publish of this proposal made since `since`, or, while
   * a builder tab has it and has not said what it pressed, that tab.
   */
  const [pressed, setPressed] = useState<{
    since: number;
    handedOff: boolean;
  } | null>(null);
  /** The publish that failed, for a Try again that replaces it. */
  const [failedRequest, setFailedRequest] = useState<string | null>(null);
  /** The proposal this one's later changes went to, once it is known. */
  const [continuation, setContinuation] = useState<string | null>(null);
  const loadChecks = useCallback(async () => {
    if (here === null) return;
    setPublishState({ kind: "checking" });
    try {
      const { checks } = await client.mergeChecks(here.name);
      setPublishState({
        kind: "ready",
        checks,
        changes: (currentJson?.changes ?? 0) + unsaved,
        unsaved,
      });
    } catch (error) {
      setPublishState({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [client, here, currentJson?.changes, unsaved]);

  /** Where the press is, while it is followed. See `pressed`. */
  const following = useMemo<
    | { kind: "running"; step: "building" | "publishing" }
    | { kind: "merged" }
    | { kind: "failed"; message: string; requestId: string | null }
    | null
  >(() => {
    if (pressed === null) return null;
    const request =
      tracked !== null && tracked.request.pressedAt >= pressed.since
        ? tracked.request
        : null;
    if (request !== null) {
      const status = request.status;
      switch (status.kind) {
        case "live":
          return { kind: "merged" };
        case "failed":
          return {
            kind: "failed",
            message: status.message,
            requestId: request.requestId,
          };
        case "cancelled":
          return {
            kind: "failed",
            message: "It was stopped before it reached the site.",
            requestId: null,
          };
        case "nothing-to-publish":
          return {
            kind: "failed",
            message: "There was nothing to publish.",
            requestId: null,
          };
        case "queued":
        case "publishing":
          return {
            kind: "running",
            step:
              request.handedOffAt !== undefined ||
              handoffState?.kind === "checking"
                ? "publishing"
                : "building",
          };
      }
    }
    if (pressed.handedOff) {
      switch (handoffState?.kind) {
        case "blocked":
          return {
            kind: "failed",
            message:
              "This browser did not open the new tab the publish is built in, so nothing was published. Press Try again: it opens the tab.",
            requestId: null,
          };
        case "failed":
          return {
            kind: "failed",
            message: handoffState.message,
            requestId: null,
          };
        case "checking":
          return { kind: "running", step: "publishing" };
        case "live":
          return { kind: "merged" };
        default:
          return { kind: "running", step: "building" };
      }
    }
    return { kind: "running", step: "building" };
  }, [pressed, tracked, handoffState]);

  /*
   * Settled: the dialog keeps the outcome, and stops following. A merge that
   * landed is followed a little further, to where what was written while it
   * merged went -- said, and offered, when it has.
   */
  const [mergedName, setMergedName] = useState<string | null>(null);
  useEffect(() => {
    if (following === null || following.kind === "running") return;
    setPressed(null);
    void refresh();
    if (following.kind === "failed") {
      setFailedRequest(following.requestId);
      setPublishState({ kind: "failed", message: following.message });
      return;
    }
    setFailedRequest(null);
    setPublishState({ kind: "merged" });
    setMergedName(here?.name ?? null);
  }, [following, here?.name, refresh]);
  useEffect(() => {
    if (mergedName === null) return;
    let stopped = false;
    // Not knowing where they went takes nothing away from the merge.
    void followCarryOver({
      get: (name) => client.get(name),
      name: mergedName,
    })
      .catch((): CarryOver => ({ kind: "unknown" }))
      .then((carried) => {
        if (stopped) return;
        // The list again, now it says where the later changes went: the
        // notice above the editor reads it from there.
        void refresh();
        if (carried.kind !== "continued") return;
        setContinuation(carried.proposal.name);
        setPublishState({
          kind: "merged",
          continuedIn: {
            displayName: carried.proposal.displayName,
            changes: carried.proposal.changes ?? 0,
          },
        });
      });
    return () => {
      stopped = true;
    };
  }, [mergedName, client, refresh]);

  /** Press the merge, or press it again: then follow it. */
  const pressMerge = useCallback(
    async (press: () => Promise<ProposalPublishPress>) => {
      const since = Date.now();
      setPressed({ since, handedOff: false });
      const answer = await press();
      if (answer.status === "error") {
        setPressed(null);
        setPublishState({ kind: "failed", message: answer.message });
        return;
      }
      setPressed({ since, handedOff: answer.status === "handed-off" });
    },
    [],
  );

  const runPublish = useCallback(async () => {
    if (here === null) return;
    const name = here.name;
    /*
     * A page that cannot run the bundler -- an iPhone, never cross-origin
     * isolated -- hands the build to a builder tab, as the site's Publish
     * does (`publish/handoff.ts`), and the tab has to open in the tap,
     * before anything here awaits. So a proposal with unsaved changes is
     * saved first, and Publish asks for a second tap.
     */
    if (unsaved > 0) {
      const checks = publishState.kind === "ready" ? publishState.checks : [];
      setPublishState({ kind: "publishing", step: "saving" });
      const failed = await save();
      if (failed !== null) {
        setPublishState({ kind: "failed", message: failed });
        return;
      }
      if (!canBuildHere()) {
        setPublishState({
          kind: "ready",
          checks,
          changes: (currentJson?.changes ?? 0) + unsaved,
          unsaved: 0,
          note: "Saved. Press Publish again: on this device the site is built in a new tab.",
        });
        return;
      }
    }
    await pressMerge(() => publishProposal(name));
  }, [
    currentJson?.changes,
    here,
    pressMerge,
    publishProposal,
    publishState,
    save,
    unsaved,
  ]);

  /** Try again, after a failure: the failed publish's own, or a new press. */
  const retryPublish = useCallback(async () => {
    if (here === null) return;
    const name = here.name;
    if (failedRequest === null) {
      await runPublish();
      return;
    }
    setFailedRequest(null);
    await pressMerge(() => retryProposalPublish(name, failedRequest));
  }, [failedRequest, here, pressMerge, retryProposalPublish, runPublish]);

  /* Settled is shown at once; the effect above keeps it once pressed clears. */
  const dialogState: PublishProposalState =
    following === null
      ? publishState
      : following.kind === "running"
        ? { kind: "publishing", step: following.step }
        : following.kind === "merged"
          ? { kind: "merged" }
          : { kind: "failed", message: following.message };

  const create = useCallback(
    async (input: { displayName: string; description: string }) => {
      setBusy("creating");
      setNewProblem(null);
      try {
        const made = await client.create({
          requestId: newProposal.requestId,
          displayName: input.displayName,
          ...(input.description ? { description: input.description } : {}),
        });
        void refresh();
        go(made.address ?? (await waitForAddress(client, made.name)));
      } catch (error) {
        const existing =
          error instanceof ProposalsApiError ? error.existing() : null;
        setNewProblem(
          existing
            ? {
                kind: "exists",
                name: existing.name,
                displayName: existing.displayName,
              }
            : {
                kind: "error",
                message: error instanceof Error ? error.message : String(error),
              },
        );
        setBusy(null);
      }
    },
    [client, go, newProposal.requestId, refresh],
  );

  const close = useCallback(async () => {
    if (here === null) return;
    setBusy("closing");
    setDialogError(null);
    try {
      await client.close(here.name);
      setDialog(null);
      // Nothing more happens here: a closed proposal takes no changes.
      if (ready?.siteUrl) {
        go(ready.siteUrl);
      } else {
        await refresh();
      }
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [client, go, here, ready?.siteUrl, refresh]);

  const rename = useCallback(
    async (displayName: string) => {
      if (here === null) return;
      setBusy("renaming");
      setDialogError(null);
      try {
        await client.rename(here.name, displayName);
        setDialog(null);
        await refresh();
      } catch (error) {
        setDialogError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(null);
      }
    },
    [client, here, refresh],
  );

  const reopen = useCallback(
    async (name: string) => {
      setReopening(name);
      try {
        await client.reopen(name);
        await refresh();
      } catch (error) {
        failed("Could not reopen the proposal", error);
      } finally {
        setReopening(null);
      }
    },
    [client, failed, refresh],
  );

  const openDialog = (next: Dialog) => {
    setDialogError(null);
    setNewProblem(null);
    if (next === "new") setNewProposal(nextNewProposal());
    setDialog(next);
  };

  if (state.status === "off" || (ready === null && here === null)) {
    return { proposals: undefined, dialogs: null, notice: null };
  }

  const proposals: TopBarProposals = {
    location,
    open: all.filter((p) => p.status === "open"),
    onOpenSite: () => {
      if (here === null) return;
      if (ready?.siteUrl) {
        go(ready.siteUrl);
      } else {
        reportError(
          "Could not open the site",
          "This project has not said where its site is served (its production URL).",
        );
      }
    },
    onOpenProposal: (name) => void openProposal(name),
    onNewProposal: () => openDialog("new"),
    onShowAllProposals: () => {
      void refresh();
      openDialog("all");
    },
    onSave: () => void save(),
    onPublish: () => {
      openDialog("publish");
      void loadChecks();
    },
    onRename: () => openDialog("rename"),
    onCopyLink: () => {
      // The address, on this page: whoever opens it lands where you are.
      copyText(window.location.href);
      toast.success("Link copied");
    },
    onClose: () => openDialog("close"),
  };

  const currentSummary =
    location.kind === "proposal" ? location.proposal : null;
  const siteUrl = ready?.siteUrl ?? null;
  const dialogs = (
    <>
      {currentSummary !== null && (
        <PublishProposalDialog
          open={dialog === "publish"}
          onOpenChange={(isOpen) => setDialog(isOpen ? "publish" : null)}
          displayName={currentSummary.displayName}
          state={dialogState}
          onPublish={() => void runPublish()}
          onRetry={() =>
            publishState.kind === "error"
              ? void loadChecks()
              : void retryPublish()
          }
          {...(onCompare !== undefined ? { onCompare } : {})}
          {...(siteUrl !== null ? { onGoToSite: () => go(siteUrl) } : {})}
          {...(continuation !== null
            ? { onOpenContinuation: () => void openProposal(continuation) }
            : {})}
          portalContainer={portalContainer}
        />
      )}
      <NewProposalDialog
        open={dialog === "new"}
        onOpenChange={(isOpen) => {
          if (busy !== "creating") setDialog(isOpen ? "new" : null);
        }}
        onCreate={(input) => void create(input)}
        onOpenExisting={(name) => {
          setDialog(null);
          void openProposal(name);
        }}
        suggestedName={newProposal.suggestedName}
        creating={busy === "creating"}
        problem={newProblem}
        portalContainer={portalContainer}
      />
      {currentSummary !== null && (
        <>
          <RenameProposalDialog
            open={dialog === "rename"}
            onOpenChange={(isOpen) => setDialog(isOpen ? "rename" : null)}
            displayName={currentSummary.displayName}
            onRename={(displayName) => void rename(displayName)}
            renaming={busy === "renaming"}
            error={dialog === "rename" ? dialogError : null}
            portalContainer={portalContainer}
          />
          <CloseProposalDialog
            open={dialog === "close"}
            onOpenChange={(isOpen) => setDialog(isOpen ? "close" : null)}
            displayName={currentSummary.displayName}
            changes={currentSummary.changes}
            merging={currentJson?.status === "merging"}
            onConfirm={() => void close()}
            closing={busy === "closing"}
            error={dialog === "close" ? dialogError : null}
            portalContainer={portalContainer}
          />
        </>
      )}
      <AllProposalsDialog
        open={dialog === "all"}
        onOpenChange={(isOpen) => setDialog(isOpen ? "all" : null)}
        proposals={all}
        loading={ready === null}
        onOpen={(name) => {
          setDialog(null);
          void openProposal(name);
        }}
        onReopen={(name) => void reopen(name)}
        onNewProposal={() => openDialog("new")}
        reopening={reopening}
        portalContainer={portalContainer}
      />
    </>
  );
  /*
   * A merged proposal is finished: said above the editor, with where to carry
   * on, before anyone types something that will not be kept.
   */
  const continuedIn =
    currentJson?.continuedIn != null
      ? (all.find((p) => p.name === currentJson.continuedIn) ?? null)
      : null;
  const notice =
    currentJson?.status === "merged" ? (
      <MergedProposalNotice
        displayName={currentJson.displayName}
        continuedIn={
          continuedIn !== null ? { displayName: continuedIn.displayName } : null
        }
        onOpenContinuation={() => {
          if (continuedIn !== null) void openProposal(continuedIn.name);
        }}
        onNewProposal={() => openDialog("new")}
        {...(siteUrl !== null ? { onGoToSite: () => go(siteUrl) } : {})}
      />
    ) : null;

  return { proposals, dialogs, notice };
}

function nextNewProposal(): { requestId: string; suggestedName: string } {
  return { requestId: randomUUID(), suggestedName: randomProposalName() };
}
