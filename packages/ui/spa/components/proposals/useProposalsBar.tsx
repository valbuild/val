import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { TopBarProposals } from "../shell/TopBar";
import {
  useCurrentAuthorId,
  useCurrentProposal,
  useProfilesByAuthorId,
  usePublishSummary,
  useReportError,
  useStudioDeployState,
  useValMode,
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
import {
  followCarryOver,
  followMerge,
  runProposalMerge,
  type CarryOver,
} from "../../proposals/mergeProposal";
import {
  canBuildHere,
  NOT_STORED_MESSAGE,
  openHandoff,
} from "../../publish/handoff";
import { createStudioJobClient } from "../../publish/jobClient";
import { callJson } from "../../publish/publishClient";
import { deployPreparedJob } from "../../publish/useStudioDeploy";
import { PUBLISH_TAB_ID } from "../../publish/tabId";
import { randomUUID } from "../../utils/randomUUID";
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
  const { publish, isPublishing } = usePublishSummary();

  const [dialog, setDialog] = useState<Dialog>(null);
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
   * the merge checks first; the button saves anything unsaved, then runs the
   * merge -- built in this tab, verified and sealed by content.
   */
  const deploy = useStudioDeployState().deploy;
  const [publishState, setPublishState] = useState<PublishProposalState>({
    kind: "checking",
  });
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
  const runPublish = useCallback(async () => {
    if (here === null) return;
    /*
     * A page that cannot run the bundler -- an iPhone, never cross-origin
     * isolated -- hands the build to a builder tab, as the site's Publish
     * does (`publish/handoff.ts`). The tab presses the merge and builds it:
     * once it takes the screen, iOS pauses this page. It has to open in the
     * tap, before anything here awaits, so a proposal with unsaved changes is
     * saved first and Publish asks for a second tap.
     */
    if (!canBuildHere()) {
      if (unsaved > 0) {
        const checks = publishState.kind === "ready" ? publishState.checks : [];
        setPublishState({ kind: "publishing", step: "saving" });
        const failed = await save();
        if (failed !== null) {
          setPublishState({ kind: "failed", message: failed });
          return;
        }
        setPublishState({
          kind: "ready",
          checks,
          changes: (currentJson?.changes ?? 0) + unsaved,
          unsaved: 0,
          note: "Saved. Press Publish again: on this device the site is built in a new tab.",
        });
        return;
      }
      const requestId = randomUUID();
      const handoff = openHandoff({
        intent: {
          kind: "merge",
          requestId,
          tab: PUBLISH_TAB_ID,
          proposal: here.name,
        },
      });
      handoff.close();
      if (!handoff.stored) {
        setPublishState({ kind: "failed", message: NOT_STORED_MESSAGE });
        return;
      }
      if (!handoff.opened) {
        setPublishState({
          kind: "failed",
          message:
            "This browser did not open the new tab the publish is built in, so nothing was published. Press Try again: it opens the tab.",
        });
        return;
      }
      setPublishState({ kind: "publishing", step: "building" });
      const outcome = await followMerge({
        jobs: createStudioJobClient({ api: "/api/val" }),
        requestId,
        timeoutMs: 10 * 60_000,
      });
      void refresh();
      setPublishState(
        outcome.kind === "merged"
          ? { kind: "merged" }
          : { kind: "failed", message: outcome.message },
      );
      return;
    }
    if (unsaved > 0) {
      setPublishState({ kind: "publishing", step: "saving" });
      const failed = await save();
      if (failed !== null) {
        setPublishState({ kind: "failed", message: failed });
        return;
      }
    }
    const jobs = createStudioJobClient({ api: "/api/val" });
    try {
      const outcome = await runProposalMerge({
        press: (input) => client.merge(here.name, input),
        publishApi: (path, body) =>
          callJson(fetch, `/api/val/publish-api${path}`, "POST", body),
        jobs,
        deploy: (prepared) => deployPreparedJob(deploy, prepared),
        tab: PUBLISH_TAB_ID,
        requestId: randomUUID(),
        onStep: (step) => setPublishState({ kind: "publishing", step }),
      });
      if (outcome.kind === "failed") {
        setPublishState({ kind: "failed", message: outcome.message });
        return;
      }
      setPublishState({ kind: "merged" });
      /*
       * What was written here while it merged goes to a new proposal, by a
       * job content runs once the merge lands: said, and offered, when it has.
       */
      // Not knowing where they went takes nothing away from the merge.
      const carried = await followCarryOver({
        get: (name) => client.get(name),
        name: here.name,
      }).catch((): CarryOver => ({ kind: "unknown" }));
      if (carried.kind === "continued") {
        setContinuation(carried.proposal.name);
        setPublishState({
          kind: "merged",
          continuedIn: {
            displayName: carried.proposal.displayName,
            changes: carried.proposal.changes ?? 0,
          },
        });
      }
    } catch (error) {
      setPublishState({
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      void refresh();
    }
  }, [
    client,
    currentJson?.changes,
    deploy,
    here,
    publishState,
    refresh,
    save,
    unsaved,
  ]);

  const create = useCallback(
    async (input: { displayName: string; description: string }) => {
      setBusy("creating");
      setNewProblem(null);
      try {
        const made = await client.create({
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
    [client, go, refresh],
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
          state={publishState}
          onPublish={() => void runPublish()}
          onRetry={() =>
            publishState.kind === "error"
              ? void loadChecks()
              : void runPublish()
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
