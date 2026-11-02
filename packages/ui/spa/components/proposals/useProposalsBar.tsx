import { RotateCcw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SourcePath } from "@valbuild/core";
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
import { useAllValidationErrors } from "../ValErrorProvider";
import { useNavigation, VAL_ERRORS_ROUTE } from "../ValRouter";
import { copyText } from "../../utils/copyText";
import {
  ProposalsApiError,
  needsCodeUpdate,
  type CodeResolution,
  type ContentHeads,
  type UpdateResolution,
  jobState,
  sameStudioPageAt,
  toSummary,
  type ProposalJson,
  type UpdateConflict,
} from "../../proposals/proposalsClient";
import { useProposals, waitForAddress } from "../../proposals/useProposals";
import {
  proposalCodeChanged,
  openBuilder,
  useProposalBuild,
} from "../../proposals/useProposalBuild";
import { useProposalTypecheck } from "../../proposals/useProposalTypecheck";
import {
  useUpgrade,
  type UpgradeButton,
  type UpgradeSettings,
} from "../../upgrade/useUpgrade";
import {
  NewProposalDialog,
  type NewProposalProblem,
} from "./NewProposalDialog";
import { CloseProposalDialog } from "./CloseProposalDialog";
import { conflictKey } from "./UpdateConflicts";
import { RenameProposalDialog } from "./RenameProposalDialog";
import {
  PublishProposalDialog,
  type PublishProposalState,
} from "./PublishProposalDialog";
import { followCarryOver, type CarryOver } from "../../proposals/carryOver";
import { canBuildHere } from "../../publish/handoff";
import { updateProposalWithCode } from "../../proposals/updateWithCode";
import { studioCodeUpdateDeps } from "../../proposals/studioCodeUpdate";
import { mergeNeedsBuild } from "../../proposals/mergeNeedsBuild";
import { randomUUID } from "../../utils/randomUUID";
import { toAdminLinks } from "../shell/shellDataMapping";
import { useValConfig } from "../ValFieldProvider";
import {
  restoreCodeOf,
  withRestoreCode,
  withoutRestoreCode,
  type RestoreDestination,
} from "../../history/restoreDestination";
import { RestoreCodeNotice, type RestoreCodeState } from "./RestoreCodeNotice";
import {
  readRememberedProposal,
  rememberProposal,
} from "../../proposals/rememberedProposal";
import type { FloatingNoticeItem } from "../shell/FloatingNotices";
import { randomProposalName } from "../../proposals/proposalNames";
import { AllProposalsDialog } from "./ProposalsList";
import { designTabUrl, siteDesignTabUrl } from "../../design/designTabUrl";
import { MergedProposalDialog } from "./MergedProposalDialog";
import {
  asksForCodeMode,
  registerCodeModeTurnOn,
  reportCodeMode,
  setCodeModeBusy,
  setCodeModeView,
  useCodeModeState,
  withCodeModeParam,
  withoutCodeModeParam,
} from "../../proposals/codeMode";
import {
  commitProposal,
  publishCommitRefusalOf,
  type CommitOutcome,
} from "../../proposals/commitProposal";
import { buildOnTheirPush } from "../../proposals/buildOnTheirPush";
import { StudioPublishError } from "@valbuild/shared/publish";
import { urlOf } from "@valbuild/shared/internal";
import { formatRelativeTime } from "../../utils/formatRelativeTime";
import {
  buildIsDue,
  previewUpdateOf,
  type ProposalCommit,
} from "./ProposalBar";
import type { PreviewProblem } from "./PreviewProblemCard";
import type { CodeModeBuild } from "./CodeModeStatus";
import { CommitMessageDialog } from "./CommitMessageDialog";
import {
  CommitRefusedNotice,
  type BuildOnPushState,
  type CommitRefused,
  type RebuildState,
} from "./CommitRefusedNotice";
import { useSettingsModuleSource } from "../../hooks/useSettingsModuleSource";
import {
  isCommitMessageRequired,
  readStudioSettings,
} from "../../hooks/studioSettings";
import { useAIChatActions } from "../AIChatActionsContext";
import { GitCommit } from "lucide-react";
import type {
  ProposalCodeState,
  ProposalPerson,
  ProposalSummary,
  StudioLocation,
} from "./types";

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

/**
 * Why an upgrade proposal cannot be published yet, by its upgrade's state;
 * null for an ordinary proposal and for an upgrade that is staged. The notice
 * above the editor said "nothing to publish yet" while Publish beside it was
 * on, which was a button that could only fail.
 */
function publishBlockedByUpgrade(
  upgrade: ProposalJson["upgrade"] | undefined,
): string | null {
  switch (upgrade?.state) {
    case "computing":
      return "Val Build is still working out this upgrade. It can be published once it is checked.";
    case "failed":
      return "This upgrade could not be worked out. Val Build has the details.";
    case "nothing":
      return "There is nothing to upgrade: the site is up to date.";
    default:
      return null;
  }
}

type Dialog = "new" | "close" | "rename" | "all" | "publish" | null;

/** No list yet: one array, so what reads it does not see a new one each render. */
const NO_PROPOSALS: ProposalJson[] = [];
const NO_NOTICES: FloatingNoticeItem[] = [];

/** How often a proposal is read again for who turned code mode on or off. */
const CODE_MODE_POLL_MS = 20_000;

/** How often a proposal waiting on its dependencies is read again. */
const DEPENDENCIES_POLL_MS = 5_000;

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
  /**
   * Popping up from below: a restore says how it went, an upgrade what it
   * upgrades. See `FloatingNotices`. A merged proposal is a dialog instead,
   * since there is nothing left to do in one.
   */
  notices: FloatingNoticeItem[];
  /**
   * Where a restore goes: a new proposal on the site of a project with
   * proposals, else here. See `restoreDestination.ts`.
   */
  restoreDestination: RestoreDestination;
  /** The Updates notice, while there is something to upgrade. */
  upgrade: UpgradeButton | null;
  /** Settings → Updates: what there is, and the way to Val Build. */
  upgradeSettings: UpgradeSettings | null;
  /** The site's address, once the proposals list has said it. */
  siteUrl: string | null;
  /**
   * Code mode's workspace, for the person whose view it is: what replaces
   * the editor and the canvas. `null` when they see the content editor.
   */
  codeWorkspace: { name: string; build: CodeModeBuild } | null;
} {
  const mode = useValMode();
  const config = useValConfig();
  const statHere = useCurrentProposal();
  /*
   * Where this Studio is, before `/stat` has said: the proposal it was in
   * last time at this address, if any. See `rememberedProposal.ts`. Once
   * `/stat` answers (the mode is known), it is what decides.
   */
  const located = mode !== "unknown";
  const [remembered] = useState(readRememberedProposal);
  const rememberedHere = useMemo(
    () =>
      remembered === null
        ? null
        : { name: remembered.name, branch: remembered.branch },
    [remembered],
  );
  const here = located ? statHere : rememberedHere;
  /*
   * Nothing is known about where this Studio is yet: the bar says it is
   * loading rather than showing the site's switcher and Publish, which at a
   * proposal's address it then took back.
   */
  const locating = !located && here === null;
  // What a save would be refused for: Save offers them, as Publish does.
  const allValidationErrors = useAllValidationErrors();
  const validationErrorPaths = Object.keys(
    allValidationErrors ?? {},
  ) as SourcePath[];
  const { navigate } = useNavigation();
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

  /*
   * Once `/stat` has said where this Studio is, remember it for the next
   * time at this address, with the name once it is read.
   */
  const knownName =
    statHere === null
      ? null
      : (ready?.current?.displayName ??
        ready?.proposals.find((p) => p.name === statHere.name)?.displayName ??
        (remembered?.name === statHere.name ? remembered.displayName : null));
  useEffect(() => {
    if (!located) return;
    rememberProposal(
      statHere === null
        ? null
        : {
            name: statHere.name,
            branch: statHere.branch,
            displayName: knownName,
          },
    );
  }, [located, statHere, knownName]);

  /** The proposal this Studio is in, as best known: its own read, or the list's. */
  const currentJson: ProposalJson | null =
    here === null
      ? null
      : (ready?.current ??
        ready?.proposals.find((p) => p.name === here.name) ??
        null);

  /*
   * Where this Studio is going, while the browser gets there: opening a
   * proposal goes to its own address, through sign-in redirects, and the page
   * being left stays on screen until the next one replaces it. The switcher
   * says so, instead of looking as though nothing was pressed.
   */
  const [leaving, setLeaving] = useState<string | null>(null);
  useEffect(() => {
    // Back to this page from the history cache: it is not leaving any more.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setLeaving(null);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
  const go = useCallback((origin: string, to?: string, inCodeMode = false) => {
    if (to !== undefined) setLeaving(to);
    const target = sameStudioPageAt(origin, window.location);
    // The `</>` menu: the proposal's Studio turns code mode on there.
    window.location.assign(inCodeMode ? withCodeModeParam(target) : target);
  }, []);

  const failed = useCallback(
    (what: string, error: unknown) =>
      reportError(what, error instanceof Error ? error.message : String(error)),
    [reportError],
  );

  const openProposal = useCallback(
    async (name: string, inCodeMode = false) => {
      if (name === here?.name) return;
      const known = ready?.proposals.find((p) => p.name === name);
      const to = known
        ? `Opening “${known.displayName}”${inCodeMode ? " in code mode" : ""}…`
        : "Opening…";
      try {
        if (known?.address) {
          go(known.address, to, inCodeMode);
          return;
        }
        // Its address may still be being made: say so while it is.
        setLeaving(to);
        if (known?.setup?.status === "failed") {
          await client.retrySetup(name);
        }
        go(await waitForAddress(client, name), to, inCodeMode);
      } catch (error) {
        setLeaving(null);
        failed("Could not open the proposal", error);
      }
    },
    [client, failed, go, here?.name, ready?.proposals],
  );

  /*
   * Its code (step 7 of valbuild/home `docs/hosted-publishing.md`): staged
   * files its address does not serve a build of, a build running, or the last
   * one failed. Read again whenever the build store says the code moved -- a
   * build finished or the assistant staged a file -- rather than on a poll.
   */
  const proposalBuild = useProposalBuild(client);
  const codeChanged = proposalBuild.state.changed;
  useEffect(() => {
    if (codeChanged > 0) void refresh();
  }, [codeChanged, refresh]);
  // The assistant was asked to change code on the site: offer a proposal.
  const proposalRequested = proposalBuild.state.proposalRequested;
  useEffect(() => {
    if (proposalRequested === 0 || here !== null) return;
    setNewProposal(nextNewProposal());
    setDialog("new");
  }, [proposalRequested, here]);
  const dependencies = currentJson?.dependencies;
  const code: ProposalCodeState | null = proposalBuild.state.inTab?.blocked
    ? { state: "blocked" }
    : proposalBuild.state.building
      ? { state: "building" }
      : dependencies?.state === "lockfile"
        ? {
            state: "lockfile",
            computing: dependencies.computing,
            error: dependencies.error,
          }
        : proposalBuild.state.error !== null
          ? { state: "failed", error: proposalBuild.state.error }
          : !currentJson?.staged?.buildRequired
            ? null
            : dependencies?.state === "pending"
              ? { state: "dependencies-building" }
              : dependencies?.state === "failed"
                ? { state: "dependencies-failed", error: dependencies.error }
                : { state: "required" };
  /*
   * Content works on the dependencies on its own -- adept computes a
   * lockfile, then builds the layer -- and nothing tells this tab when it is
   * done: it asks again while it is.
   */
  const waitingOnDependencies =
    here !== null &&
    (dependencies?.state === "pending" ||
      (dependencies?.state === "lockfile" && dependencies.computing));
  useEffect(() => {
    if (!waitingOnDependencies) return;
    const timer = setInterval(() => void refresh(), DEPENDENCIES_POLL_MS);
    return () => clearInterval(timer);
  }, [waitingOnDependencies, refresh]);
  const build = proposalBuild.build;
  const blocked = proposalBuild.state.inTab?.blocked === true;
  const needsLockfile =
    code?.state === "lockfile" && !code.computing ? here?.name : undefined;
  const computeLockfile = useCallback(async () => {
    if (here === null) return;
    try {
      await client.computeLockfile(here.name);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "The lockfile could not be computed",
      );
    }
    await refresh();
  }, [client, here, refresh]);
  const runBuild = useCallback(async () => {
    // Nothing can be built before the lockfile: the button computes it.
    if (needsLockfile !== undefined) {
      await computeLockfile();
      return;
    }
    if (build === null) return;
    // The build is waiting on a tab the browser did not let open: open it.
    if (blocked) {
      openBuilder();
      return;
    }
    const outcome = await build();
    if (outcome.status === "built")
      toast.success("Built: the preview shows the change");
  }, [needsLockfile, computeLockfile, blocked, build]);

  /*
   * The typecheck of a proposal with dependencies of its own (decision 20):
   * Publish waits for one of what it stages, with no new errors, so it is
   * started here as soon as there is a lockfile to check against -- at its
   * own address, where it can be reported -- once per staged inputs.
   */
  const onTypechecked = useCallback(() => void refresh(), [refresh]);
  const typecheck = useProposalTypecheck({ client, onReported: onTypechecked });
  const stagedInputs = currentJson?.staged?.inputs ?? null;
  const typecheckDue =
    here !== null &&
    stagedInputs !== null &&
    (dependencies?.state === "own" || dependencies?.state === "pending") &&
    currentJson?.typecheck?.inputs !== stagedInputs;
  const typecheckState = typecheck.state;
  const runTypecheck = typecheck.run;
  const typecheckTried = useRef<string | null>(null);
  useEffect(() => {
    if (!typecheckDue || runTypecheck === null || stagedInputs === null) return;
    if (typecheckState.status === "running") return;
    // Once per inputs: a typecheck that failed is tried again by a person.
    if (typecheckTried.current === stagedInputs) return;
    typecheckTried.current = stagedInputs;
    void runTypecheck();
  }, [typecheckDue, runTypecheck, typecheckState.status, stagedInputs]);

  const location: StudioLocation = useMemo(() => {
    if (here === null) return { kind: "site" };
    const proposal: ProposalSummary = currentJson
      ? toSummary(currentJson, viewer, people)
      : {
          // Its own read has not answered yet: the name it had last time
          // here, if any.
          name: here.name,
          displayName:
            remembered?.name === here.name && remembered.displayName !== null
              ? remembered.displayName
              : "Proposal",
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
      publishBlockedBy:
        publishBlockedByStatus(currentJson?.status) ??
        publishBlockedByUpgrade(currentJson?.upgrade),
      code,
    };
  }, [
    here,
    currentJson,
    viewer,
    people,
    unsaved,
    isPublishing,
    saveError,
    code,
    remembered,
  ]);

  /*
   * Code mode (`docs/plans/one-content-model.md`, "Code mode"): the
   * proposal's, from content, and the same for everyone in it. Shared with
   * the assistant through `codeMode.ts`.
   */
  const codeModeJson = here !== null ? (currentJson?.codeMode ?? null) : null;
  const codeOn = codeModeJson?.on === true;
  const codeModeStore = useCodeModeState();
  /*
   * Everyone in the proposal sees the `</>` turn: someone else's switch is
   * read again while this tab is in front. The code tools never rely on it --
   * they ask content before each write.
   */
  const inAProposal = here !== null;
  useEffect(() => {
    if (!inAProposal) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, CODE_MODE_POLL_MS);
    return () => clearInterval(timer);
  }, [inAProposal, refresh]);
  useEffect(() => {
    reportCodeMode(
      here === null || currentJson === null
        ? null
        : { name: here.name, displayName: currentJson.displayName, on: codeOn },
    );
  }, [here, currentJson, codeOn]);

  /** Save; the reason it did not, or null when it did. */
  const save = useCallback(async (): Promise<string | null> => {
    setSaveError(null);
    const name = currentJson?.displayName ?? "the proposal";
    let failed: string | null = null;
    try {
      const result = await publish(
        `Saved in ${name}`,
        // In code mode a save takes invalid content too: see `codeMode`.
        codeOn ? { invalidAllowed: true } : undefined,
      );
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
  }, [currentJson?.displayName, publish, refresh, codeOn]);

  /**
   * Turn code mode on or off, for everyone in the proposal: one call to Val's
   * server, which saves every pending change before it turns it on. The
   * reason it did not, or `null` when it did.
   */
  const setCodeMode = useCallback(
    async (on: boolean): Promise<string | null> => {
      if (here === null) return "Code mode is turned on in a proposal.";
      setCodeModeBusy(true);
      try {
        await client.setCodeMode(here.name, on);
        // Whoever turns it on sees it; turning it off sends nobody anywhere.
        if (on) setCodeModeView("code");
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      } finally {
        setCodeModeBusy(false);
        void refresh();
      }
    },
    [client, here, refresh],
  );
  const toggleCodeMode = useCallback(
    async (on: boolean) => {
      const failed = await setCodeMode(on);
      if (failed === null) return;
      toast.error(
        on
          ? "Code mode could not be turned on"
          : "Code mode could not be turned off",
        {
          description: failed,
          action: {
            label: "Try again",
            onClick: () => void toggleCodeModeRef.current(on),
          },
        },
      );
    },
    [setCodeMode],
  );
  const toggleCodeModeRef = useRef(toggleCodeMode);
  toggleCodeModeRef.current = toggleCodeMode;
  // The assistant's `request_code_mode` card turns it on the same way.
  useEffect(() => {
    if (here === null) return;
    registerCodeModeTurnOn(() => setCodeMode(true));
    return () => registerCodeModeTurnOn(null);
  }, [here, setCodeMode]);
  /*
   * Arriving from the `</>` menu on the site: the address asks for code mode
   * (`CODE_MODE_PARAM`). Turned on if it is off, and shown, once the
   * proposal's own read says which; the parameter is taken out of the
   * address so a reload does not ask again.
   */
  const codeModeAsked = useRef(false);
  const ownRead = statHere !== null && currentJson !== null;
  useEffect(() => {
    if (!ownRead || codeModeAsked.current) return;
    if (!asksForCodeMode(window.location.href)) return;
    codeModeAsked.current = true;
    window.history.replaceState(
      window.history.state,
      "",
      withoutCodeModeParam(window.location.href),
    );
    setCodeModeView("code");
    if (!codeOn) void toggleCodeMode(true);
  }, [ownRead, codeOn, toggleCodeMode]);

  /*
   * Save, and update the preview: Save is the proposal's one main button,
   * and with nothing to save it updates a preview that is behind.
   */
  const saveAndBuild = useCallback(async () => {
    // A save that failed is tried again by the same press.
    if (unsaved > 0 || saveError !== null) {
      const failed = await save();
      if (failed !== null) return;
    }
    if (buildIsDue(code)) await runBuild();
  }, [unsaved, saveError, save, code, runBuild]);

  /*
   * Commit, in a project connected to git: the proposal as it was last
   * saved, as one commit on its branch. Saves go there no more (content's
   * code-mode contract, section 4), so this -- or Publish -- is how a
   * developer finds the proposal in git.
   */
  const git = currentJson?.git ?? null;
  const settingsModule = useSettingsModuleSource();
  const messageRequired =
    (settingsModule.moduleFilePath !== null &&
      settingsModule.source === undefined) ||
    isCommitMessageRequired(readStudioSettings(settingsModule.source));
  const [committing, setCommitting] = useState(false);
  /*
   * Somebody pushed to the proposal's branch, so Commit -- or the commit
   * Publish makes first -- was refused, and Build on their push is where
   * that goes: one for both, since it is the same branch and the same push.
   */
  const [theirPush, setTheirPush] = useState<TheirPush | null>(null);
  const theirPushRef = useRef(theirPush);
  theirPushRef.current = theirPush;
  const [askingMessage, setAskingMessage] = useState<
    "commit" | "publish" | null
  >(null);
  /** Publish's commit message, where the project asks for one. */
  const publishMessage = useRef<string | null>(null);
  const runCommit = useCallback(
    async (message: string) => {
      if (here === null) return;
      setCommitting(true);
      const before = theirPushRef.current;
      setTheirPush(null);
      try {
        // Unsaved changes are not in a commit: saved first.
        if (unsaved > 0) {
          const failed = await save();
          if (failed !== null) {
            toast.error("Nothing was committed", {
              description: `The changes could not be saved first: ${failed}`,
            });
            return;
          }
        }
        const outcome = await commitProposal(client, here.name, message);
        if (outcome.status === "committed") {
          const url = outcome.url;
          toast.success(
            outcome.pushed
              ? `Committed to ${outcome.branch ?? "its branch"}`
              : "Everything saved was committed already",
            {
              action: { label: "View commit", onClick: () => window.open(url) },
            },
          );
          return;
        }
        if (outcome.status === "someone-pushed") {
          // Pressing again would be refused the same way: see the notice.
          setTheirPush({
            refused: refusedOf(outcome, "commit", before),
            buildOn: { kind: "idle" },
            commitMessage: message,
          });
          return;
        }
        const branchUrl = outcome.branchUrl;
        toast.error("Nothing was committed", {
          description: outcome.message,
          ...(outcome.canRetry
            ? {
                action: {
                  label: "Try again",
                  onClick: () => void runCommitRef.current(message),
                },
              }
            : branchUrl !== null
              ? {
                  // Trying again cannot help: where to see why can.
                  action: {
                    label: "Open the branch",
                    onClick: () => window.open(branchUrl),
                  },
                }
              : {}),
        });
      } finally {
        setCommitting(false);
        void refresh();
      }
    },
    [client, here, unsaved, save, refresh],
  );
  const runCommitRef = useRef(runCommit);
  runCommitRef.current = runCommit;

  /*
   * Build on their push: their changes brought into the proposal, then
   * Commit (or Publish) again. The preview is rebuilt with their code here,
   * as after any staging -- content does not start that build itself.
   */
  const runBuildRef = useRef(runBuild);
  runBuildRef.current = runBuild;
  const runBuildOnPush = useCallback(async () => {
    const pushed = theirPushRef.current;
    if (here === null || pushed === null) return;
    const during = pushed.refused.during;
    const update = (buildOn: TheirPush["buildOn"]) =>
      setTheirPush((now) => (now === null ? null : { ...now, buildOn }));
    update({ kind: "building" });
    const outcome = await buildOnTheirPush(
      client,
      here.name,
      pushed.refused.commit.sha,
    );
    switch (outcome.status) {
      case "taken":
        update({
          kind: "built",
          kept: outcome.kept,
          notTaken: outcome.notTaken,
          rewritten: outcome.rewritten,
        });
        await refresh();
        if (outcome.proposal.staged?.buildRequired === true) {
          void runBuildRef.current();
        }
        return;
      case "someone-pushed":
        // Their push moved again: this is the one to build on now.
        setTheirPush((now) =>
          now === null
            ? null
            : {
                ...now,
                refused: refusedOf(outcome, during, now),
                buildOn: { kind: "idle" },
              },
        );
        return;
      case "nothing-to-take":
        update({
          kind: "failed",
          message: `There is nothing of theirs to bring in any more: the branch is where Val left it. ${during === "commit" ? "Commit" : "Publish"} again.`,
          offer: { kind: "again" },
        });
        return;
      case "failed":
        update({
          kind: "failed",
          message: outcome.message,
          offer:
            outcome.offer?.kind === "sign-in"
              ? { kind: "sign-in", url: signInUrl() }
              : outcome.offer,
        });
        return;
    }
  }, [client, here, refresh]);
  const defaultCommitMessage = `Changes in “${currentJson?.displayName ?? "the proposal"}”`;
  const commit: ProposalCommit | undefined =
    git === null || here === null
      ? undefined
      : {
          branch: git.branch,
          state: committing ? "committing" : "idle",
          upToDate: !git.uncommitted && unsaved === 0,
          onCommit: () => {
            if (messageRequired) setAskingMessage("commit");
            else void runCommit(defaultCommitMessage);
          },
        };

  /*
   * The preview could not be updated: what happened and the ways on, on the
   * switcher -- never on Save. Who caused it is not known here yet.
   */
  const update = previewUpdateOf(code);
  const { askAssistant } = useAIChatActions();
  const previewProblem: PreviewProblem | null =
    update.state !== "failed"
      ? null
      : {
          error: update.error,
          cause: null,
          onAskAssistant: () => {
            if (!codeOn) void toggleCodeMode(true);
            askAssistant(
              `The proposal's preview could not be updated with the latest code. This is the error:\n\n${update.error}\n\nFind what causes it and fix it.`,
            );
          },
          ...(update.canRetry ? { onRetry: () => void runBuild() } : {}),
        };
  /** Where the preview is, as code mode's workspace says it. */
  const buildPercent = proposalBuild.progress?.percent ?? null;
  const codeBuild: CodeModeBuild =
    update.state === "updating"
      ? {
          state: "updating",
          progress: buildPercent === null ? null : buildPercent / 100,
        }
      : previewProblem !== null
        ? { state: "failed", problem: previewProblem }
        : update.state === "behind" || update.state === "blocked"
          ? { state: "behind" }
          : { state: "up-to-date" };

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

  /*
   * "Update from the site" (step 8.2): the site's changes since the proposal
   * started, merged into it, as a pull request is brought up to date.
   *
   * - Content only -- nothing staged, the site on the build the proposal
   *   stands on: Val's server here merges under its own schemas
   *   (`updateContent`). It says when that is not the case.
   * - Otherwise the merge needs each tree's schemas, which only running its
   *   code gives: this page bundles and evaluates them
   *   (`updateProposalWithCode`), and what the merge leaves staged is built.
   *
   * What both changed comes back as conflicts, decided in the dialog, and the
   * same update with those decisions merges. Either way the checks are read
   * again after.
   */
  const [updating, setUpdating] = useState(false);
  const [conflicts, setConflicts] = useState<{
    of: "content" | "code";
    list: UpdateConflict[];
    /** Content's: where the site and the proposal were, sent back. */
    heads?: ContentHeads;
  } | null>(null);
  /**
   * Every decision made in this update so far, across its rounds: a content
   * round can be followed by a code round with other conflicts, and the
   * merge then still needs the first round's answers.
   */
  const [decided, setDecided] = useState<(UpdateResolution | CodeResolution)[]>(
    [],
  );
  const buildProposalNow = proposalBuild.build;
  const updateFromSite = useCallback(
    async (checkId: string, keep: ("site" | "proposal")[] = []) => {
      if (here === null) return;
      setUpdating(true);
      const now = (conflicts?.list ?? []).flatMap(
        (conflict, at): (UpdateResolution | CodeResolution)[] => {
          const kept = keep[at];
          if (kept === undefined) return [];
          if (conflict.kind === "field") {
            return [
              {
                moduleFilePath: conflict.moduleFilePath,
                path: conflict.path,
                keep: kept,
              },
            ];
          }
          if (conflict.kind === "code") {
            return [{ file: conflict.file, keep: kept }];
          }
          return [];
        },
      );
      // A conflict decided again is decided as it was last.
      const resolutions = [
        ...decided.filter(
          (earlier) =>
            !now.some((r) => conflictKey(r) === conflictKey(earlier)),
        ),
        ...now,
      ];
      const done = () => {
        setConflicts(null);
        setDecided([]);
      };
      try {
        let withCode =
          conflicts?.of === "code" ||
          (checkId === "site-code" && canBuildHere());
        if (!withCode && checkId !== "published-since") {
          // The site's code moved and this page cannot read code: onto the
          // site's build, its own code built again there, as before 8.2.
          await client.updateFromSite(here.name);
          done();
          proposalCodeChanged();
          await loadChecks();
          return;
        }
        if (!withCode) {
          try {
            const answer = await client.updateContent(
              here.name,
              resolutions.filter(
                (r): r is UpdateResolution => "moduleFilePath" in r,
              ),
              conflicts?.heads,
            );
            if (answer.status === "conflicts") {
              setDecided(resolutions);
              setConflicts({
                of: "content",
                list: answer.conflicts,
                heads: {
                  siteHead: answer.siteHead,
                  proposalHead: answer.proposalHead,
                },
              });
              return;
            }
            done();
            await loadChecks();
            return;
          } catch (error) {
            if (!needsCodeUpdate(error)) throw error;
            withCode = true;
          }
        }
        if (!canBuildHere()) {
          setPublishState({
            kind: "error",
            message:
              "This proposal changes code, or the site's code changed, so updating it reads the code in this browser -- and this one cannot. Open the proposal in Chrome or Edge on a computer to update it.",
            update: { checkId: null },
          });
          return;
        }
        const outcome = await updateProposalWithCode(
          here.name,
          resolutions,
          studioCodeUpdateDeps(client),
        );
        if (outcome.status === "conflicts") {
          setDecided(resolutions);
          setConflicts({ of: "code", list: outcome.conflicts });
          return;
        }
        done();
        proposalCodeChanged();
        // What the merge staged is built over the site's build, as any staged
        // code is: the address serves it once it is.
        if (
          outcome.status === "updated" &&
          outcome.proposal.staged?.buildRequired &&
          buildProposalNow !== null
        ) {
          void buildProposalNow();
        }
        await loadChecks();
      } catch (error) {
        // Kept for Try again, which sends the same decisions.
        setDecided(resolutions);
        setPublishState({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
          update: { checkId },
        });
      } finally {
        setUpdating(false);
      }
    },
    [buildProposalNow, client, conflicts, decided, here, loadChecks],
  );

  /** Where the press is, while it is followed. See `pressed`. */
  const following = useMemo<
    | { kind: "running"; step: "building" | "publishing" }
    | { kind: "merged" }
    | {
        kind: "failed";
        message: string;
        requestId: string | null;
        /** Content's refusal of the press, when it was one: see `refusedPublish`. */
        cause?: unknown;
      }
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
            // The builder tab pressed, and content refused it: why, as data.
            ...(handoffState.refused !== undefined
              ? {
                  cause: new StudioPublishError(
                    handoffState.refused.status,
                    handoffState.refused.message,
                    handoffState.refused.body,
                  ),
                }
              : {}),
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
      refusedPublishRef.current(following.message, following.cause);
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

  /*
   * A press of Publish refused, as the dialog says it: the commit Publish
   * makes first, refused because somebody pushed, offers Build on their
   * push -- Try again would be refused the same way -- and one GitHub
   * refused for good links where to see why.
   */
  const refusedPublish = useCallback((message: string, cause: unknown) => {
    const refusal = publishCommitRefusalOf(cause);
    if (refusal?.status === "someone-pushed") {
      const before = theirPushRef.current;
      const refused = refusedOf(refusal, "publish", before);
      setTheirPush({ refused, buildOn: { kind: "idle" }, commitMessage: null });
      setPublishState({
        kind: "someone-pushed",
        refused,
        buildOn: { kind: "idle" },
      });
      return;
    }
    if (
      refusal?.status === "failed" &&
      !refusal.canRetry &&
      refusal.branchUrl !== null
    ) {
      setPublishState({
        kind: "failed",
        message: refusal.message,
        seeWhy: { label: "Open the branch", url: refusal.branchUrl },
      });
      return;
    }
    setPublishState({ kind: "failed", message });
  }, []);
  const refusedPublishRef = useRef(refusedPublish);
  refusedPublishRef.current = refusedPublish;

  /** Press the merge, or press it again: then follow it. */
  const pressMerge = useCallback(
    async (press: () => Promise<ProposalPublishPress>) => {
      const since = Date.now();
      setPressed({ since, handedOff: false });
      const answer = await press();
      if (answer.status === "error") {
        setPressed(null);
        refusedPublish(answer.message, answer.cause);
        return;
      }
      setPressed({ since, handedOff: answer.status === "handed-off" });
    },
    [refusedPublish],
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
    const needsBuild = mergeNeedsBuild(currentJson);
    if (unsaved > 0) {
      const checks = publishState.kind === "ready" ? publishState.checks : [];
      setPublishState({ kind: "publishing", step: "saving" });
      const failed = await save();
      if (failed !== null) {
        setPublishState({ kind: "failed", message: failed });
        return;
      }
      // Only a merge that builds needs the tab, and so the second tap.
      if (!canBuildHere() && needsBuild) {
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
    const commitMessage = publishMessage.current;
    await pressMerge(() =>
      publishProposal(name, {
        needsBuild,
        ...(commitMessage !== null ? { commitMessage } : {}),
      }),
    );
  }, [
    currentJson,
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
    await pressMerge(() =>
      retryProposalPublish(name, failedRequest, {
        needsBuild: mergeNeedsBuild(currentJson),
      }),
    );
  }, [
    currentJson,
    failedRequest,
    here,
    pressMerge,
    retryProposalPublish,
    runPublish,
  ]);

  /*
   * Their push, while it is brought in and the preview rebuilt: the bar
   * keeps it (`theirPush`), and Commit's notice and Publish's dialog both
   * show it from there.
   */
  const takenBuilding = currentJson?.git?.takenIn?.building === true;
  const buildOnState = (pushed: TheirPush): BuildOnPushState =>
    pushed.buildOn.kind === "built"
      ? { ...pushed.buildOn, rebuild: rebuildOf(code, takenBuilding) }
      : pushed.buildOn;

  /* Settled is shown at once; the effect above keeps it once pressed clears. */
  const dialogState: PublishProposalState =
    following === null
      ? publishState.kind === "ready" && conflicts !== null
        ? { ...publishState, conflicts: conflicts.list }
        : publishState.kind === "someone-pushed" &&
            theirPush !== null &&
            theirPush.refused.during === "publish"
          ? {
              kind: "someone-pushed",
              refused: theirPush.refused,
              buildOn: buildOnState(theirPush),
            }
          : publishState
      : following.kind === "running"
        ? { kind: "publishing", step: following.step }
        : following.kind === "merged"
          ? { kind: "merged" }
          : { kind: "failed", message: following.message };

  /** New proposal from the `</>` menu: it opens in code mode. */
  const newInCodeMode = useRef(false);
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
        go(
          made.address ?? (await waitForAddress(client, made.name)),
          `Opening “${made.displayName}”…`,
          newInCodeMode.current,
        );
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
        go(ready.siteUrl, "Opening the site…");
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

  const onSite = here === null && ready !== null;
  const openWithChanges = useCallback(
    async (input: {
      displayName: string;
      patchIds: string[];
      requestId: string;
      restoreCodeFrom?: string;
    }) => {
      const made = await client.create({
        displayName: input.displayName,
        patchIds: input.patchIds,
        requestId: input.requestId,
      });
      void refresh();
      const origin = made.address ?? (await waitForAddress(client, made.name));
      const target = sameStudioPageAt(origin, window.location);
      window.location.assign(
        input.restoreCodeFrom === undefined
          ? target
          : withRestoreCode(target, input.restoreCodeFrom),
      );
    },
    [client, refresh],
  );

  /*
   * "Go back to this point", arriving: the site's Studio opened this proposal
   * with the content moved in and the commit whose code to bring back in the
   * address (`RESTORE_CODE_PARAM`). Only a proposal's own server may stage
   * its files, so it is done here, once, and the parameter is taken out of
   * the address so a reload does not ask again.
   */
  const [restoreCode, setRestoreCode] = useState<RestoreCodeState | null>(null);
  const runRestoreCode = useCallback(
    async (name: string, commit: string) => {
      setRestoreCode({ kind: "restoring", commit });
      try {
        await client.restoreCode(name, commit);
        proposalCodeChanged();
        void refresh();
        setRestoreCode({ kind: "restored", commit });
      } catch (error) {
        setRestoreCode({
          kind: "failed",
          commit,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [client, refresh],
  );
  const restoreAsked = useRef(false);
  useEffect(() => {
    if (here === null || restoreAsked.current) return;
    const commit = restoreCodeOf(window.location.href);
    if (commit === null) return;
    restoreAsked.current = true;
    window.history.replaceState(
      window.history.state,
      "",
      withoutRestoreCode(window.location.href),
    );
    void runRestoreCode(here.name, commit);
  }, [here, runRestoreCode]);
  const restoreDestination = useMemo<RestoreDestination>(
    () =>
      onSite ? { kind: "proposal", open: openWithChanges } : { kind: "here" },
    [onSite, openWithChanges],
  );

  const openDialog = (next: Dialog) => {
    setDialogError(null);
    setNewProblem(null);
    if (next === "new") setNewProposal(nextNewProposal());
    setDialog(next);
  };

  const siteName = config?.project?.split("/")[1] ?? null;
  const upgrade = useUpgrade({
    enabled: state.status !== "off",
    adminProject: toAdminLinks(config)?.project ?? null,
    here,
    proposals: ready?.proposals ?? NO_PROPOSALS,
    current: currentJson,
    onRefresh: onTypechecked,
    ...(siteName !== null ? { siteName } : {}),
    contentChanges:
      location.kind === "proposal"
        ? location.proposal.changes + location.unsaved
        : 0,
  });

  if (
    !locating &&
    (state.status === "off" || (ready === null && here === null))
  ) {
    return {
      proposals: undefined,
      dialogs: null,
      notices: NO_NOTICES,
      restoreDestination,
      upgrade: null,
      upgradeSettings: null,
      siteUrl: null,
      codeWorkspace: null,
    };
  }

  // Where the design tab is: the site's address, never this one.
  const designUrl =
    location.kind !== "proposal"
      ? null
      : ready?.siteUrl
        ? designTabUrl(
            window.location.href,
            location.proposal.name,
            ready.siteUrl,
          )
        : siteDesignTabUrl(window.location.href, location.proposal.name);
  const proposals: TopBarProposals = {
    location,
    // Where this Studio is, or which proposal it is, still being read.
    loading: locating || (here !== null && currentJson === null),
    leaving,
    ...(validationErrorPaths.length > 0
      ? {
          saveBlockedBy: {
            errors: validationErrorPaths.length,
            onShow: () =>
              navigate(VAL_ERRORS_ROUTE, {
                errorFields: validationErrorPaths,
              }),
          },
        }
      : {}),
    open: all.filter((p) => p.status === "open"),
    onOpenSite: () => {
      if (here === null) return;
      if (ready?.siteUrl) {
        go(ready.siteUrl, "Opening the site…");
      } else {
        reportError(
          "Could not open the site",
          "This project has not said where its site is served (its production URL).",
        );
      }
    },
    onOpenProposal: (name) => void openProposal(name),
    onNewProposal: () => {
      newInCodeMode.current = false;
      openDialog("new");
    },
    onShowAllProposals: () => {
      void refresh();
      openDialog("all");
    },
    onSave: () => void save(),
    // An upgrade is built in Val Build, which the notice above the editor opens.
    ...(build !== null && currentJson?.upgrade === undefined
      ? { onBuild: () => void runBuild() }
      : {}),
    onPublish: () => {
      // Publish commits first where there is git: the message is asked for
      // first where the project requires one.
      if (git !== null && messageRequired) {
        setAskingMessage("publish");
        return;
      }
      publishMessage.current = null;
      openDialog("publish");
      void loadChecks();
    },
    ...(build !== null && currentJson?.upgrade === undefined
      ? { onSaveAndBuild: () => void saveAndBuild() }
      : {}),
    previewProblem,
    ...(commit !== undefined ? { commit } : {}),
    codeMode: {
      on: codeOn,
      onToggle: () => void toggleCodeMode(!codeOn),
      busy: codeModeStore.busy,
      turnedOn:
        codeOn &&
        codeModeJson?.changedBy != null &&
        codeModeJson.changedAt != null
          ? {
              by:
                codeModeJson.changedBy === viewer
                  ? "you"
                  : (people(codeModeJson.changedBy)?.name ?? "someone"),
              ago: formatRelativeTime(codeModeJson.changedAt, Date.now()),
            }
          : null,
      view: codeModeStore.view,
      onViewChange: setCodeModeView,
      onOpenProposalInCodeMode: (name) => void openProposal(name, true),
      onNewProposalInCodeMode: () => {
        newInCodeMode.current = true;
        openDialog("new");
      },
      openMenuRequests: codeModeStore.menuRequests,
    },
    onRename: () => openDialog("rename"),
    onCopyLink: () => {
      // The address, on this page: whoever opens it lands where you are.
      copyText(window.location.href);
      toast.success("Link copied");
    },
    onClose: () => openDialog("close"),
    ...(designUrl !== null
      ? { onOpenDesign: () => window.open(designUrl, "_blank") }
      : {}),
  };

  const currentSummary =
    location.kind === "proposal" ? location.proposal : null;
  const siteUrl = ready?.siteUrl ?? null;
  const continuedIn =
    currentJson?.continuedIn != null
      ? (all.find((p) => p.name === currentJson.continuedIn) ?? null)
      : null;
  /*
   * A merged proposal is finished, and says so in a dialog that does not
   * close onto it -- unless another dialog it led to (New proposal, All
   * proposals) is open in its place.
   */
  const merged = currentJson?.status === "merged" && dialog === null;
  const dialogs = (
    <>
      {currentSummary !== null && (
        <PublishProposalDialog
          open={dialog === "publish"}
          onOpenChange={(isOpen) => setDialog(isOpen ? "publish" : null)}
          displayName={currentSummary.displayName}
          {...(currentJson?.upgrade !== undefined
            ? { upgrade: currentJson.upgrade }
            : {})}
          {...(siteName !== null ? { siteName } : {})}
          state={dialogState}
          onPublish={() => void runPublish()}
          onRetry={() => {
            if (publishState.kind !== "error") return void retryPublish();
            const checkId = publishState.update?.checkId;
            if (checkId === undefined || checkId === null) {
              return void loadChecks();
            }
            // The checks first, so what the update answers is shown in them.
            void loadChecks().then(() => updateFromSite(checkId));
          }}
          {...(onCompare !== undefined ? { onCompare } : {})}
          {...(siteUrl !== null
            ? { onGoToSite: () => go(siteUrl, "Opening the site…") }
            : {})}
          {...(continuation !== null
            ? { onOpenContinuation: () => void openProposal(continuation) }
            : {})}
          onUpdateFromSite={(checkId) => void updateFromSite(checkId)}
          onComputeLockfile={() =>
            void computeLockfile().then(() => loadChecks())
          }
          {...(runTypecheck !== null
            ? {
                onTypecheck: () => void runTypecheck().then(() => loadChecks()),
              }
            : {})}
          typechecking={typecheckState.status === "running"}
          onResolve={(keep) => void updateFromSite("published-since", keep)}
          onCancelUpdate={() => {
            setConflicts(null);
            setDecided([]);
          }}
          updating={updating}
          onBuildOnPush={() => void runBuildOnPush()}
          onRebuild={() => void runBuild()}
          onBuild={() => void runBuild().then(() => loadChecks())}
          building={previewUpdateOf(code).state === "updating"}
          portalContainer={portalContainer}
        />
      )}
      {currentJson !== null && (
        <MergedProposalDialog
          open={merged}
          displayName={currentJson.displayName}
          continuedIn={
            continuedIn !== null
              ? { displayName: continuedIn.displayName }
              : null
          }
          onOpenContinuation={() => {
            if (continuedIn !== null) void openProposal(continuedIn.name);
          }}
          onNewProposal={() => openDialog("new")}
          onShowAllProposals={() => {
            void refresh();
            openDialog("all");
          }}
          {...(siteUrl !== null
            ? { onGoToSite: () => go(siteUrl, "Opening the site…") }
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
            upgrade={currentSummary.upgrade === true}
            merging={currentJson?.status === "merging"}
            onConfirm={() => void close()}
            closing={busy === "closing"}
            error={dialog === "close" ? dialogError : null}
            portalContainer={portalContainer}
          />
        </>
      )}
      {git !== null && (
        <CommitMessageDialog
          open={askingMessage !== null}
          onOpenChange={(isOpen) => {
            if (!isOpen) setAskingMessage(null);
          }}
          purpose={askingMessage ?? "commit"}
          branch={git.branch}
          onCommit={(message) => {
            const purpose = askingMessage;
            setAskingMessage(null);
            if (purpose === "publish") {
              publishMessage.current = message;
              openDialog("publish");
              void loadChecks();
            } else {
              void runCommit(message);
            }
          }}
          portalContainer={portalContainer}
        />
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
   * A code restore under way at this address, or how it ended: a notice that
   * stays until it is dismissed, so a failure is not missed.
   */
  const restoreNotice: FloatingNoticeItem | null =
    restoreCode !== null && here !== null
      ? {
          id: `restore:${restoreCode.commit}:${restoreCode.kind}`,
          label:
            restoreCode.kind === "restoring"
              ? "Restoring code…"
              : restoreCode.kind === "restored"
                ? "Code restored"
                : "Restore failed",
          icon: <RotateCcw size={13} />,
          content: (
            <RestoreCodeNotice
              state={restoreCode}
              onRetry={() => void runRestoreCode(here.name, restoreCode.commit)}
              onDismiss={() => setRestoreCode(null)}
            />
          ),
        }
      : null;
  /*
   * A Commit refused because someone else pushed: stays until dismissed, so
   * who pushed, the link to their commit and Build on their push are not
   * missed -- and then what came in, and Commit again.
   */
  const commitPushed =
    theirPush !== null && theirPush.refused.during === "commit"
      ? theirPush
      : null;
  const commitNotice: FloatingNoticeItem | null =
    commitPushed !== null
      ? {
          id: `commit-refused:${commitPushed.refused.commit.sha}`,
          label:
            commitPushed.buildOn.kind === "building"
              ? "Building on their push…"
              : commitPushed.buildOn.kind === "built"
                ? "Their push is in"
                : "Not committed",
          icon: <GitCommit size={13} />,
          content: (
            <CommitRefusedNotice
              refused={commitPushed.refused}
              state={buildOnState(commitPushed)}
              onBuildOn={() => void runBuildOnPush()}
              onAgain={() =>
                void runCommit(
                  commitPushed.commitMessage ?? defaultCommitMessage,
                )
              }
              onRebuild={() => void runBuild()}
              onDismiss={() => setTheirPush(null)}
            />
          ),
        }
      : null;
  const notices = [commitNotice, restoreNotice, upgrade.notice].filter(
    (each): each is FloatingNoticeItem => each !== null,
  );

  return {
    proposals,
    dialogs,
    notices,
    restoreDestination,
    upgrade: upgrade.button,
    upgradeSettings: upgrade.settings,
    siteUrl,
    codeWorkspace:
      here !== null && codeOn && codeModeStore.view === "code"
        ? { name: here.name, build: codeBuild }
        : null,
  };
}

function nextNewProposal(): { requestId: string; suggestedName: string } {
  return { requestId: randomUUID(), suggestedName: randomProposalName() };
}

/**
 * Somebody's push to the proposal's branch, which refused Commit or the
 * commit Publish makes first, and how far building on it has got. The
 * rebuild of the preview is not kept here: it is read from the build.
 */
type TheirPush = {
  refused: CommitRefused;
  buildOn:
    | Exclude<BuildOnPushState, { kind: "built" }>
    | Omit<Extract<BuildOnPushState, { kind: "built" }>, "rebuild">;
  /** The message Commit was pressed with, for Commit again. */
  commitMessage: string | null;
};

/** The refusal as the notice shows it; `movedAgain` when it is a newer push. */
function refusedOf(
  outcome: Extract<CommitOutcome, { status: "someone-pushed" }>,
  during: CommitRefused["during"],
  before: TheirPush | null,
): CommitRefused {
  return {
    branch: outcome.branch,
    branchUrl: outcome.branchUrl,
    who: outcome.who,
    ago: outcome.ago,
    commit: outcome.theirs,
    during,
    ...(before !== null && before.refused.commit.sha !== outcome.theirs.sha
      ? { movedAgain: true }
      : {}),
  };
}

/**
 * The preview, rebuilt with their code: what this tab's build says, and,
 * once it is quiet, whether content has a build with their code
 * (`git.takenIn.building`). Built here, as after any staging; Publish waits
 * for it.
 */
function rebuildOf(
  code: ProposalCodeState | null,
  takenBuilding: boolean,
): RebuildState {
  const update = previewUpdateOf(code);
  switch (update.state) {
    case "updating":
      return { state: "running" };
    case "failed":
      return {
        state: "failed",
        message: update.error,
        canRetry: update.canRetry,
      };
    case "behind":
    case "blocked":
      return { state: "due" };
    case "up-to-date":
      // Nothing building here, and content has no build with their code.
      return takenBuilding ? { state: "due" } : { state: "done" };
  }
}

/** Sign in, and come back to this page. */
function signInUrl(): string {
  return urlOf("/api/val/authorize", { redirect_to: window.location.href });
}
