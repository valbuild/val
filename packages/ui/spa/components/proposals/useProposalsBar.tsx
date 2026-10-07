import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { TopBarProposals } from "../shell/TopBar";
import {
  useCurrentAuthorId,
  useCurrentProposal,
  useProfilesByAuthorId,
  usePublishSummary,
  useReportError,
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
import { AllProposalsDialog } from "./ProposalsList";
import type { ProposalPerson, ProposalSummary, StudioLocation } from "./types";

/**
 * Merging is session 5 (`docs/proposals.md`, Flow F). Until then Publish in
 * a proposal is shown, so the bar looks as it will, and says why it waits.
 */
const PUBLISH_NOT_YET =
  "Publishing a proposal merges it into the site, and merging is not built yet.";

type Dialog = "new" | "close" | "rename" | "all" | null;

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
}: {
  /** Changes made since the last save: the Save button's count. */
  unsaved: number;
  portalContainer?: HTMLElement | null;
}): {
  /** `undefined` where this project has no proposals. */
  proposals: TopBarProposals | undefined;
  dialogs: ReactNode;
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
      publishBlockedBy: PUBLISH_NOT_YET,
    };
  }, [here, currentJson, viewer, people, unsaved, isPublishing, saveError]);

  const save = useCallback(async () => {
    setSaveError(null);
    const name = currentJson?.displayName ?? "the proposal";
    try {
      const result = await publish(`Saved in ${name}`);
      if (result.status === "refused" || result.status === "failed") {
        setSaveError(
          "message" in result && typeof result.message === "string"
            ? result.message
            : "The save was refused",
        );
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      void refresh();
    }
  }, [currentJson?.displayName, publish, refresh]);

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
    return { proposals: undefined, dialogs: null };
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
    onPublish: () => undefined,
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
  const dialogs = (
    <>
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
  return { proposals, dialogs };
}
