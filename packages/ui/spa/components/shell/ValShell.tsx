import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { ValCanvasElement } from "@valbuild/shared/internal";
import { findShellSelection, Shell, ShellSelection } from "./Shell";
import type { PageWorkspaceProps } from "./canvas/PageWorkspace";
import { CanvasFrame } from "./canvas/CanvasFrame";
import { canvasFallbackRoute } from "./canvasFallbackRoute";
import { SaveState } from "./StatusBar";
import { RemoteFilesCard, UploadsOffChip } from "./RemoteFilesNotice";
import {
  useStudioAccess,
  type StudioAccessState,
} from "./planLimits/useStudioAccess";
import { useResumeRefusedSaves } from "./planLimits/useResumeRefusedSaves";
import { usePlanNotice } from "./planLimits/usePlanNotice";
import { useRefusalToastRefresh } from "./planLimits/useRefusalToastRefresh";
import { PlanNoticeCard } from "./planLimits/PlanNoticeCard";
import { PlanStatusBar } from "./planLimits/PlanStatusBar";
import { planToastAction } from "./planLimits/planCopy";
import { useRemoteFiles } from "../ValRemoteProvider";
import { useSteadySaveState } from "./useSteadySaveState";
import { PublishState } from "./TopBar";
import {
  ShellBreakpoint,
  ShellData,
  ShellDestination,
  ShellExternalPage,
  ShellMediaGallery,
  ShellValidationError,
} from "./types";
import { useShellData } from "./useShellData";
import { ValSettingsSections } from "./ValSettingsSections";
import { ValSiteUpdate } from "./ValSiteUpdate";
import { ConnectedExternalPages } from "./ConnectedExternalPages";
import { useValPortal } from "../ValPortalProvider";
import { useContentSearch } from "./useContentSearch";
import {
  parseShellUrlState,
  ShellUrlState,
  useShellUrlState,
  useWriteShellUrlState,
} from "./useShellUrlState";
import { Module } from "../Module";
import { useRequestUpload } from "../UploadRequest";
import { useAddPage } from "../useAddPage";
import { useDuplicatePage } from "../useDuplicatePage";
import { useRenamePage } from "../useRenamePage";
import { PublishButton } from "../PublishButton";
import { ValidateRoute } from "../validate/ValidateRoute";
import { useValidateCount } from "../validate/useValidateCount";
import { ComparePatchSets, CompareLoading } from "../ComparePatchSets";
import { isPathWithin } from "../../utils/sourcePath";
import { cn } from "../designSystem/cn";
import { CLEAR_OF_BOTTOM_BARS } from "./MobileChrome";
import { useValDemo } from "../../demo/ValDemoContext";
import { DemoBanner } from "../../demo/DemoBanner";
import { DemoPublishButton } from "../../demo/DemoPublishButton";
import {
  demoTourSteps,
  readDemoTourSeen,
  writeDemoTourSeen,
} from "../../demo/demoTour";
import { PublishHandoffCard, handoffCardInStudio } from "./PublishHandoff";
import { usePublishIndicator } from "../../publish/usePublishIndicator";
import { LoginDialog } from "../LoginDialog";
import { PatchErrorsDialog } from "../PatchErrorsDialog";
import { GlobalErrors } from "../GlobalErrors";
import { TransientErrorToasts } from "../TransientErrorToasts";
import { Toaster } from "../designSystem/sonner";
import { useTheme } from "../ValThemeProvider";
import {
  VAL_ERRORS_ROUTE,
  VAL_HISTORY_ROUTE,
  VAL_REVIEW_ROUTE,
  scrollToStudioPath,
  useNavigation,
  useHistoryParams,
} from "../ValRouter";
import { HistoryPane } from "../../history/HistoryPane";
import { ReviewLoader, ReviewSurface } from "../../review/ReviewSurface";
import { useDiscardAll } from "../useDiscardAll";
import { historyEnabledFor } from "./historyEnabled";
import { CommitList } from "../../history/CommitList";
import { PanelEmptyState } from "./FloatingPanel";
import { useCommitList } from "../../history/useCommitList";
import { useValConfig } from "../ValFieldProvider";
import { RestoreControls } from "../../history/RestoreControls";
import { RestoreModeProvider } from "../../history/RestoreModeContext";
import { useDirectedRestore } from "../../history/useDirectedRestore";
import { HistorySplit } from "../../history/HistorySplit";
import { useHistoricalCommit } from "../../history/useHistoricalCommit";
import {
  useAllPatchErrors,
  useAuthenticationState,
  useConnectionStatus,
  useProfilesError,
  usePatchSets,
  usePendingClientSidePatchIds,
  useProfilesByAuthorId,
  usePublishCount,
  usePublishSummary,
  useStudioDeployState,
  useSiteHandoffState,
  useOtherPublishJobs,
  useStudioIsDeployer,
  useHasNetChanges,
  usePendingChangeCount,
  useInitialPatchesApplied,
  usePatchFetchError,
  usePendingChangesProgress,
  useValMode,
  useAutoPublish,
  useCurrentProposal,
  useHistoryBranch,
  useReportError,
  useChangesWithoutModuleNotice,
  useGlobalTransientErrors,
} from "../ValProvider";
import {
  useFilePatchIds,
  useGetNavPath,
  useResolveNavPath,
} from "../ValFieldProvider";
import type { NavPathResolution } from "../getNavPath";
import { refToUrl } from "../MediaPicker/refToUrl";
import { useAllValidationErrors } from "../ValErrorProvider";
import { AIChatSurface } from "../AIChatSurface";
import { useAIChatActions, useInsertFieldRef } from "../AIChatActionsContext";
import { useValSystem } from "../../stores/react/SystemContext";
import { useProjectLocales } from "../../hooks/useProjectLocales";
import { useStudioSettings } from "../../hooks/useStudioSettings";
import { isTourOffered } from "../../hooks/studioSettings";
import { LocaleFilterProvider } from "../LocaleFilterProvider";
import { useProposalsBar } from "../proposals/useProposalsBar";
import { useSiteChanges } from "../../proposals/useSiteChanges";
import { ProposalSiteCompare } from "../../proposals/ProposalSiteCompare";
import { AdeptView } from "./AdeptView";

/**
 * The Val studio on the floating shell.
 *
 * The shell itself is presentational: it takes `ShellData` and calls back. This
 * is the half that knows about Val — it reads the providers, hands the shell
 * the real field editor, and turns a selection into navigation. Everything the
 * shell cannot answer on its own (publishing, the compare and errors views,
 * signing out) is delegated to the components that already own it rather than
 * reimplemented against the new layout.
 */
export function ValShell() {
  const shellData = useShellData();
  const authenticationState = useAuthenticationState();
  /**
   * What the project's plan allows, from Val Build: the organization's
   * read-only state and the project's own limits. See `planLimits/`. Asked
   * only where the Studio is connected to Val Build (the same test that
   * mounts its web components): elsewhere the proxy has nothing to forward
   * to, and answers 404. Here rather than in the body because the toasts
   * below use it too, to put the next step beside a refused write.
   */
  const project = useValConfig()?.project;
  const valBuildConnected =
    authenticationState !== "login-required" &&
    shellData.status === "success" &&
    shellData.data.webComponentsUrl !== undefined;
  const studioAccess = useStudioAccess(valBuildConnected ? project : undefined);
  const { access } = studioAccess;
  useResumeRefusedSaves(access);
  const toastActionFor = useCallback(
    (error: { message: string; details?: string }) => {
      const action =
        planToastAction(access, error.details) ??
        planToastAction(access, error.message);
      if (action === null) return undefined;
      return {
        label: action.label,
        onClick: () => {
          if (action.external) window.open(action.href, "_blank", "noopener");
          else window.location.assign(action.href);
        },
      };
    },
    [access],
  );

  if (authenticationState === "login-required") {
    return (
      <div className="min-h-[100svh] bg-bg-primary">
        <LoginDialog />
      </div>
    );
  }

  return (
    <>
      <ValShellBody state={shellData} studioAccess={studioAccess} />
      <Toaster />
      <TransientErrorToasts actionFor={toastActionFor} />
      <PatchErrorsDialog />
      <GlobalErrors />
    </>
  );
}

/**
 * Split from `ValShell` so the login gate above returns before any of these
 * hooks run: a signed-out session has no profile, no patch sets and no
 * navigation to load, and asking for them only produces failing requests
 * behind the login dialog.
 */
function ValShellBody({
  state,
  studioAccess,
}: {
  state: ReturnType<typeof useShellData>;
  studioAccess: StudioAccessState;
}) {
  /*
   * A demo (`docs/plans/demo-mode.md`): the same Studio, with its own tour,
   * a card saying what this is, Publish explained rather than done, and no
   * uploads. Read once at mount, as whether the tour has been seen in this
   * tab is.
   */
  const demo = useValDemo();
  const [demoTourPending] = useState(
    () => demo !== null && !readDemoTourSeen(),
  );
  const buildDemoTourSteps = useMemo(
    () =>
      demo === null
        ? undefined
        : (project: { destinations: readonly ShellDestination[] }) =>
            demoTourSteps({ ...project, uploads: demo.uploads }),
    [demo],
  );
  const { resolvedTheme, setTheme, themeStyle } = useTheme();
  /**
   * The outline colours to hand the canvas frame.
   *
   * `themeStyle` holds them because `themeCustomProperties` writes
   * `--bg-page-selection` and its soft variant explicitly — see the note there
   * on why they cannot be left to `var()`. Taking them from the same object the
   * chrome uses is what keeps the page's outlines and the studio's pick button
   * the same colour.
   */
  const canvasSelectionColors = useMemo(() => {
    const selection = themeStyle["--bg-page-selection"];
    const selectionSoft = themeStyle["--bg-page-selection-soft"];
    if (typeof selection !== "string" || typeof selectionSoft !== "string") {
      return undefined;
    }
    return { selection, selectionSoft };
  }, [themeStyle]);
  const mode = useValMode();
  /**
   * Why there is no profile, when the studio expected one.
   *
   * Only once it has given up retrying — see `useProfilesError`. Nothing in the
   * editor depends on it, so this is reported beside the account rather than as
   * a banner: `/profiles` answering "Project not found" is a configuration
   * problem, not a reason to stop working.
   */
  const profilesError = useProfilesError();
  /**
   * Whether there is an assistant at all.
   *
   * `assistant.enabled` in the project's settings module, resolved by
   * `useAssistantAvailability` and carried here by `AIChatActionsProvider`. Not
   * the connection: an assistant that is currently offline still gets its
   * panel, which is where `aiConnectionError` and its retry are shown.
   */
  const { isAIChatEnabled, setOpenAIChatImpl } = useAIChatActions();
  /**
   * Whether this project offers the guided tour — `studio.tour` in
   * `s.settings()`. Unset means yes; see `isTourOffered`.
   */
  const studioSettings = useStudioSettings();
  const insertFieldRef = useInsertFieldRef();
  const navigation = useNavigation();
  const validateCount = useValidateCount();
  const { history } = useHistoryParams();
  const commitState = useHistoricalCommit(history.commitSha);
  const connectionStatus = useConnectionStatus();
  const pendingClientSidePatchIds = usePendingClientSidePatchIds();
  const { patchErrors } = useAllPatchErrors();
  const validationErrors = useAllValidationErrors();
  // The query the search overlay is showing, so the content index can answer
  // it. Held here because the overlay is presentational and the index is not.
  const [searchQuery, setSearchQuery] = useState("");
  const contentSearch = useContentSearch(searchQuery);
  /**
   * Remote files unavailable: a card above the editor, folded into a chip in
   * the status bar once dismissed. See `RemoteFilesNotice`. Read from the
   * remote settings themselves rather than `useGlobalError`, which reports one
   * error at a time and would hide this behind a passing network blip.
   */
  const remoteFiles = useRemoteFiles();
  const [remoteNoticeDismissed, setRemoteNoticeDismissed] = useState(false);
  const remoteFilesNotice =
    remoteFiles.status === "inactive" && !remoteNoticeDismissed ? (
      <RemoteFilesCard
        reason={remoteFiles.reason}
        onDismiss={() => setRemoteNoticeDismissed(true)}
      />
    ) : undefined;
  /**
   * The plan: one notice above everything, most pressing first -- the
   * organization made the Studio read-only (a failed payment), a save or a
   * publish Val Build refuses, an upload it refuses, a Hosted month running
   * out -- and a compact status (a trial's days, Free's changes) in the top
   * bar. Each with the next step beside it. See `planLimits/planNotices.ts`.
   */
  const project = useValConfig()?.project;
  const hasNetChanges = useHasNetChanges();
  const pendingChangeCount = usePendingChangeCount();
  const plan = usePlanNotice(studioAccess, {
    project: project?.split("/")[1] || null,
    changesWaiting: hasNetChanges ? pendingChangeCount : 0,
  });
  /*
   * A refused save, publish or upload reports an error. One whose words are
   * Val Build's refusal (they name its Billing) asks `/access` again, so the
   * notice that explains it appears. See `useRefusalToastRefresh`.
   */
  const { globalTransientErrors } = useGlobalTransientErrors();
  useRefusalToastRefresh(globalTransientErrors, studioAccess);
  const editorNotices = [
    plan.notice === null ? null : (
      <PlanNoticeCard
        key={`plan-${plan.notice.id}`}
        notice={plan.notice}
        onDismiss={() => {
          if (plan.notice !== null) plan.dismiss(plan.notice);
        }}
      />
    ),
    remoteFilesNotice === undefined ? null : (
      <div key="remote-files">{remoteFilesNotice}</div>
    ),
  ].filter((notice) => notice !== null);
  const editorNotice =
    editorNotices.length === 0 ? undefined : (
      <div className="flex flex-col gap-3">{editorNotices}</div>
    );
  const planStatusValue = plan.status;
  const planStatus =
    planStatusValue === null
      ? undefined
      : (placement: "top-bar" | "column") => (
          <PlanStatusBar status={planStatusValue} placement={placement} />
        );
  const remoteFilesStatusNotice =
    remoteFiles.status === "inactive" && remoteNoticeDismissed ? (
      <UploadsOffChip onClick={() => setRemoteNoticeDismissed(false)} />
    ) : undefined;

  /**
   * The view state, from the URL and back into it.
   *
   * Read once on mount — that is what a link restores — and written back as it
   * changes, so the address bar is always a link to what is on screen.
   */
  const urlState = useShellUrlState();
  // The project's languages, for the locale filter in the chrome. Empty for a
  // project that has not declared any, which hides the filter entirely.
  //
  // From the context, same as every field: the read is `ValProvider`'s, so the
  // shell is one more consumer rather than the owner. See
  // `ProjectLocalesProvider`.
  const projectLocales = useProjectLocales();
  // Owned here rather than in the shell: the filter has to reach the FIELDS,
  // which the shell renders through a slot and does not own. See
  // `LocaleFilterProvider`.
  const [locale, setLocale] = useState<string | null>(urlState.initial.locale);
  const [viewState, setViewState] = useState<
    Omit<ShellUrlState, "canvasRoute" | "locale">
  >(() => ({
    panel: urlState.initial.panel,
    canvasOpen: urlState.initial.canvasOpen,
    canvasView: urlState.initial.canvasView,
    canvasTransform: urlState.initial.canvasTransform,
  }));
  const { isPublishing } = usePublishSummary();
  const { state: deployState } = useStudioDeployState();
  const studioIsDeployer = useStudioIsDeployer();
  const handoff = useSiteHandoffState();
  /**
   * Whether the fields can be trusted yet.
   *
   * Latched once — see `useInitialPatchesApplied`: on the first paint a field
   * may be showing published content while the pending change to it is still on
   * its way, and an editor typing over that "fixes" something that was never
   * wrong.
   */
  const pendingChangesLoaded = useInitialPatchesApplied();
  // Changes left behind by a renamed or deleted file: told, with Discard.
  useChangesWithoutModuleNotice();
  const portalContainer = useValPortal();
  const discardAll = useDiscardAll();
  /*
   * The branch history is listed under, which decides whether History is
   * offered at all: the proposal's in a proposal, else the site's (see
   * `useHistoryBranch`). Null only for a deployment with no history.
   */
  const shellHistoryBranch = useHistoryBranch();
  // Only read when the wait has already gone on too long — see
  // `PendingChangesGate`.
  const pendingChangesProgress = usePendingChangesProgress();
  const pendingChangesError = usePatchFetchError();

  /**
   * Back and forward, for the canvas.
   *
   * Opening or closing the canvas pushes a history entry — see
   * `useWriteShellUrlState` — so the button has to actually take you there. The
   * URL is re-parsed on `popstate` and handed to the shell as a state to adopt;
   * `epoch` is what marks it as a command rather than as the URL becoming a
   * controlled prop, which would fight every move the user makes.
   */
  const [restoreViewState, setRestoreViewState] = useState<{
    epoch: number;
    panel: ShellUrlState["panel"];
    canvasOpen: boolean;
    canvasView: ShellUrlState["canvasView"];
  }>();
  useEffect(() => {
    const listener = () => {
      const state = parseShellUrlState(window.location.search);
      setRestoreViewState((previous) => ({
        epoch: (previous?.epoch ?? 0) + 1,
        panel: state.panel,
        canvasOpen: state.canvasOpen,
        canvasView: state.canvasView,
      }));
      // Adopted directly rather than through `restoreViewState`: the locale is
      // owned here, not by the shell. Without this, going back to an entry with
      // a different `?locale=` left the filter on the language it had been
      // moved to — and the next URL write put that language back into the
      // address bar, so the entry could not be reached at all.
      setLocale(state.locale);
    };
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);

  /**
   * Open the assistant from outside the shell.
   *
   * Through the same `restoreViewState` command channel `popstate` uses,
   * because it is the only way in: the shell owns which panel is open, and a
   * mention on a field — or on the canvas — has to be able to say "the
   * assistant, now" without becoming a controlled prop that fights every panel
   * the user opens themselves.
   *
   * The canvas half of the command is carried through unchanged, from a ref
   * rather than from `viewState` directly: this is registered once, and
   * rebuilding it whenever the canvas moves would re-register on every pan.
   * Without it, mentioning a field would shut the canvas the field is on.
   */
  const viewStateRef = useRef(viewState);
  viewStateRef.current = viewState;
  const openAIPanel = useCallback(() => {
    setRestoreViewState((previous) => ({
      epoch: (previous?.epoch ?? 0) + 1,
      panel: "ai",
      canvasOpen: viewStateRef.current.canvasOpen,
      canvasView: viewStateRef.current.canvasView,
    }));
  }, []);
  useEffect(() => {
    if (!isAIChatEnabled) return;
    setOpenAIChatImpl(openAIPanel);
    return () => setOpenAIChatImpl(null);
  }, [isAIChatEnabled, setOpenAIChatImpl, openAIPanel]);

  const data: ShellData =
    state.status === "success" ? state.data : EMPTY_SHELL_DATA;
  const otherPublishJobs = useOtherPublishJobs();
  const publishIndicatorState = usePublishIndicator({
    own: deployState,
    builder:
      handoff.state?.kind === "running"
        ? {
            step: handoff.state.step,
            percent: handoff.state.percent ?? null,
          }
        : null,
    jobs: otherPublishJobs,
    deployments: data.deployments,
    studioIsDeployer,
  });

  /**
   * The route, as a selection id.
   *
   * Ids are the thing a row opens, so most of the time this is the route
   * itself. It is not always equal, though: navigating to a field inside a
   * module gives a path that extends the row's id, so the longest id that the
   * route starts with is the row we are on.
   */
  const selectionId = useMemo(
    () => resolveSelectionId(data, navigation.currentSourcePath),
    [data, navigation.currentSourcePath],
  );

  // The selection itself, for the things that need more than its id: the
  // canvas needs the URL the page is on.
  const selection = useMemo(
    () => (selectionId === null ? null : findShellSelection(data, selectionId)),
    [data, selectionId],
  );

  // The router is the single source of truth for what is open, so a selection
  // is a navigation rather than a state change: a reload lands where you were.
  const onSelectionChange = useCallback(
    (selection: ShellSelection) => {
      navigation.navigate(selection.sourcePath as SourcePath);
    },
    [navigation],
  );

  /**
   * The field the canvas points at.
   *
   * The route's focus when it has one, and the route itself otherwise. The two
   * differ exactly when a field was opened in context: the editor is on the
   * page and this is the field inside it, which is what the outline on the page
   * and the mark in the fields list follow — so they stay on the field being
   * edited rather than jumping to the whole page.
   */
  const focusedPath: SourcePath | null =
    navigation.focusedSourcePath ??
    ((navigation.currentSourcePath as SourcePath | "") || null);

  /**
   * Coming back to the module editor lands on the field you were editing.
   *
   * The fields view and the module editor are two ways of looking at the same
   * field, so switching between them should not lose your place — and the scroll
   * the navigation did happened when the field was opened, which for a switch is
   * long past. Also covers a cold load on a link that named a field, where the
   * module's own content arrives after the route does.
   */
  useEffect(() => {
    if (viewState.canvasView !== "normal") return;
    const focused = navigation.focusedSourcePath;
    if (!focused) return;
    scrollToStudioPath(focused);
  }, [viewState.canvasView, navigation.focusedSourcePath]);

  /**
   * The editor for what the route points at.
   *
   * The *route*, not the selection's own path. A selection is a row in the
   * navigation, and a row is a whole module; the route can be deeper —
   * `?p="image"` inside it, which is what a deep link, a search result, a
   * validation error and a pick on the canvas all produce. Rendering the row's
   * path instead opened the module every time and quietly ignored the rest of
   * the route, so every one of those landed on the right module and the wrong
   * place in it.
   */
  const renderEditor = useCallback(
    (selection: ShellSelection) => (
      <Module
        path={
          (navigation.currentSourcePath || selection.sourcePath) as SourcePath
        }
        showModuleGalleryChild={null}
      />
    ),
    [navigation.currentSourcePath],
  );

  /**
   * The settings panel's sections.
   *
   * The connected half is mounted only while the panel is open (the shell calls
   * this from inside it), which is what keeps a project without a settings
   * module from calling hooks with a path it does not have.
   */
  const renderSettings = useCallback(
    () => (
      <>
        {/*
         * First, and only where the Studio is what builds the site: an update
         * is a rebuild and a publish, which is the Studio's job for a managed
         * project and nobody's here for a connected one.
         */}
        {studioIsDeployer && <ValSiteUpdate />}
        <ValSettingsSections moduleFilePath={data.settings?.moduleFilePath} />
      </>
    ),
    [data.settings?.moduleFilePath, studioIsDeployer],
  );

  /**
   * The external pages dialog.
   *
   * Only called while it is open - `Shell` owns that state - so the reference
   * index it builds over the whole project does not exist until someone asks
   * for it. Absent when the project has no external router, and then the Pages
   * panel has no button for it either.
   *
   * Not a `useCallback`, for the same reason `renderHistory` is not one: the
   * whole thing is absent in the case that matters, and a hook cannot be.
   */
  const renderExternalPages =
    data.externalModuleFilePath === undefined
      ? undefined
      : ({
          close,
          onSelectExternalPage,
          breakpoint,
        }: {
          close: () => void;
          onSelectExternalPage: (page: ShellExternalPage) => void;
          breakpoint: ShellBreakpoint;
        }) => (
          <ConnectedExternalPages
            pages={data.externalPages}
            moduleFilePath={data.externalModuleFilePath}
            // Empty means "none yet" only once the record has arrived. Opened
            // during the fetch it said the project had no external pages,
            // which is the one answer the dialog must not guess at.
            isLoading={data.externalPagesLoading}
            schemes={data.externalSchemes}
            breakpoint={breakpoint}
            portalContainer={portalContainer}
            onClose={close}
            onSelectExternalPage={onSelectExternalPage}
          />
        );

  /**
   * The route the canvas opens on.
   *
   * A page selection is a router entry, and a route pointing anywhere inside one
   * resolves back to that entry — see `resolveSelectionId` — so "on a route, or
   * somewhere under one" is exactly a page selection, and there the canvas opens
   * on that page.
   *
   * Everywhere else it opens on the root: a data module, a gallery, the compare
   * view, the errors view, nothing selected at all. This used to remember the
   * last page instead, which made sense while the canvas stayed open across a
   * non-page selection — but it does not any more (see `Shell`), so what
   * remembering produced was a canvas opening on a page you had left, from a
   * screen with no relationship to it.
   */
  /** The page the editor is on, or null when it is not on one. */
  const selectedPageRoute =
    selection?.kind === "page" ? selection.urlPath : null;

  /**
   * A route typed into the canvas's address bar.
   *
   * Kept apart from the selection because the two are allowed to disagree: the
   * canvas can be pointed at a route that has no content module at all — a
   * page not built yet, a route Val does not track — while the editor stays on
   * whatever is selected. Cleared whenever the selection moves, so picking a
   * page in the navigation takes the canvas there too, which is what picking a
   * page means.
   */
  const [typedRoute, setTypedRoute] = useState<string | null>(
    urlState.initial.canvasRoute,
  );
  // Cleared when the selection moves, but not on the first render: a link that
  // named a route meant it, and the selection it arrives with is the one the
  // route was saved beside.
  const isFirstSelection = useRef(true);
  useEffect(() => {
    if (isFirstSelection.current) {
      isFirstSelection.current = false;
      return;
    }
    setTypedRoute(null);
  }, [selectedPageRoute]);

  /** The routes Val resolves, for the address bar's suggestions. */
  /**
   * Every route Val resolves, and the module behind it.
   *
   * One walk for both, because the address bar needs both answers about the same
   * row: which routes to offer, and — when one is picked — what to open in the
   * editor.
   */
  const routeSourcePaths = useMemo(() => {
    const byRoute = new Map<string, SourcePath>();
    const walk = (pages: ShellData["pages"]) => {
      for (const page of pages) {
        if (page.sourcePath !== undefined) {
          // First wins: two rows can resolve to the same URL, and the shallower
          // one is the page rather than a nested re-statement of it.
          if (!byRoute.has(page.urlPath)) {
            byRoute.set(page.urlPath, page.sourcePath as SourcePath);
          }
        }
        walk(page.children ?? []);
      }
    };
    walk(data.pages);
    return byRoute;
  }, [data.pages]);

  /**
   * Point the canvas somewhere, and follow it when Val knows the route.
   *
   * The editor used to stay where it was: picking `/blogs/blog-7` in the address
   * bar moved the frame and left `p` on whichever page was open, so the fields
   * beside the canvas were a different page's — which reads as the bar having
   * picked the wrong route rather than as the two having come apart.
   *
   * Only for a route Val resolves. Typing a path with no content module behind
   * it is a deliberate use of the bar — looking at a page that does not exist
   * yet — and there is nothing to open for it.
   */
  const onCanvasRouteChange = useCallback(
    (route: string) => {
      setTypedRoute(route);
      const sourcePath = routeSourcePaths.get(route);
      if (sourcePath !== undefined) {
        navigation.navigate(sourcePath);
      }
    },
    [routeSourcePaths, navigation],
  );

  /**
   * The routes the address bar offers, in URL order.
   *
   * From the map above, so they are deduplicated by construction. A duplicate is
   * not merely untidy: the bar keys its options by route, so two options with
   * the same key make React reuse one of them for the other's handler, and
   * picking a route can commit its neighbour.
   *
   * Sorted because the map is in tree order, which puts `/blogs/blog1` and
   * `/blogs/blog-2` in whatever order the router happened to enumerate them. A
   * list you are scanning for a URL should be in URL order.
   */
  const canvasRoutes = useMemo(
    () =>
      Array.from(routeSourcePaths.keys()).sort((a, b) => a.localeCompare(b)),
    [routeSourcePaths],
  );

  /**
   * Where the canvas points when the editor is not on a page.
   *
   * Compare, Errors, a data module, the media panel — none of them names a page,
   * and the canvas still has to point somewhere. The root is the honest default:
   * it is the page every site has and the one an editor recognises.
   *
   * Unless the project does not TRACK the root, which is common enough — a site
   * whose home page is static, or one whose content starts at `/blog`. Loading
   * `/` then puts a page Val knows nothing about on the canvas: no fields,
   * nothing selectable, which reads as the canvas being broken rather than as
   * the page not being Val's. The first route it does track is a page the editor
   * can actually work on, and the route bar above it lists the rest to pick
   * from.
   */
  const fallbackRoute = useMemo(
    () => canvasFallbackRoute(canvasRoutes),
    [canvasRoutes],
  );

  /** The page the canvas is showing. Never null — see `fallbackRoute`. */
  const selectedRoute = selectedPageRoute ?? fallbackRoute;
  const canvasUrl = typedRoute ?? selectedRoute;

  /**
   * The URL, kept in step with the view.
   *
   * The typed route is only recorded when it differs from the selected page's
   * own: otherwise every link would carry a route that says nothing the route
   * it is already on does not.
   */
  useWriteShellUrlState(
    urlState.write,
    useMemo(
      (): ShellUrlState => ({
        ...viewState,
        locale,
        canvasRoute:
          typedRoute !== null && typedRoute !== selectedRoute
            ? typedRoute
            : null,
      }),
      [viewState, locale, typedRoute, selectedRoute],
    ),
  );

  /**
   * What the page says is on it.
   *
   * Held here rather than in the frame because it is what makes the canvas part
   * of the editor: a click on the page has to become a navigation, and the
   * column beside it has to list the same things.
   */
  const [canvasElements, setCanvasElements] = useState<ValCanvasElement[]>([]);

  /**
   * The reported paths, deduplicated and in the order they appear on the page.
   *
   * Reading order, because that is the order someone works down the page in.
   * Deduplicated because one path can be on several elements — a value used
   * twice is tagged twice — and the same field twice in a list is noise.
   */
  const canvasPaths = useMemo(() => {
    const seen = new Set<string>();
    const ordered: SourcePath[] = [];
    for (const element of canvasElements) {
      for (const path of element.paths) {
        if (seen.has(path)) continue;
        seen.add(path);
        ordered.push(path);
      }
    }
    return ordered;
  }, [canvasElements]);

  /**
   * Open the page in a new tab, with preview mode on.
   *
   * Through the enable endpoint rather than straight to the page, so the tab
   * shows the unpublished work rather than what is live — which is the only
   * reason to open a preview rather than the site. The endpoint sets the
   * cookies and redirects, so the new tab lands on the page already in preview.
   */
  const previewHref = useMemo(() => {
    const target = new URL(canvasUrl, window.location.origin).toString();
    return `/api/val/enable?redirect_to=${encodeURIComponent(target)}`;
  }, [canvasUrl]);
  const openPreviewTab = useCallback(() => {
    window.open(previewHref, "_blank", "noopener,noreferrer");
  }, [previewHref]);

  /**
   * A thumbnail URL for a file in a gallery.
   *
   * The same resolution the media picker uses, which is the part that has to be
   * shared: a just-uploaded file is only readable through `/api/val/files` with
   * its patch id, and a published one is served straight from `/public`. Doing
   * it a second way here is how a freshly uploaded image comes to render as a
   * broken one.
   */
  const filePatchIds = useFilePatchIds();
  const getMediaFileUrl = useCallback(
    (ref: string) => refToUrl(ref, filePatchIds),
    [filePatchIds],
  );

  /**
   * Upload into the gallery the navigation picked.
   *
   * Opens it, then asks it to open its file dialog. The panel knows which
   * gallery you meant; only `ModuleGallery` knows how to upload into one — the
   * ref from the file's hash and the gallery's directory, local or remote, the
   * metadata entry and the file op as one patch — so the upload stays there
   * rather than existing twice. See `UploadRequest`.
   */
  /**
   * Create a page, and open it.
   *
   * The same write the classic nav menu does — one `add` op at the new URL key,
   * with a value shaped by the router's item schema — so the two entry points
   * cannot come to disagree about what an empty page is. See `useAddPage`.
   */
  const addPage = useAddPage();
  /**
   * Copy a page to another URL, and open the copy.
   *
   * The router module IS the record, so the two URLs are the two keys and the
   * copy is one `copy` op - see `useDuplicateRecordEntry`, which the page's own
   * toolbar goes through as well.
   */
  const duplicatePage = useDuplicatePage();
  /**
   * Change a page's URL, and open it there.
   *
   * More than a rename of a key: everything pointing at the old URL has to be
   * rewritten in the same breath, which is what `useRenamePage` is for - and
   * what makes it worth a hook of its own rather than a second call to
   * `useRenameRecordEntry` here.
   */
  const renamePage = useRenamePage();

  const requestUpload = useRequestUpload();
  const uploadInto = useCallback(
    (gallery: ShellMediaGallery) => {
      // The same boundary cast `renderEditor` makes: the shell's own types are
      // plain strings so the layout can be built without the providers, and the
      // brand is put back on at the edge.
      const moduleFilePath = gallery.moduleFilePath as ModuleFilePath;
      navigation.navigate(moduleFilePath);
      requestUpload(moduleFilePath);
    },
    [navigation, requestUpload],
  );

  /**
   * Open one field, from the page or from the list beside it.
   *
   * The editor opens at the nearest sensible ancestor of the field rather than
   * at the field itself, and the field is scrolled to inside it. Opening the
   * exact path put one field on screen and nothing else — pick a page's title
   * on the canvas and the whole rest of the page vanished from the editor,
   * which is the opposite of what picking something is for.
   *
   * `getNavPath` is the same resolution the rest of the studio's navigation
   * uses, so a canvas pick lands where a search hit or a validation error on
   * the same field would. The field itself travels as the route's focus, which
   * is what keeps it outlined on the page and marked in the fields list — so
   * switching between the two canvas views stays on the field being edited.
   */
  const getNavPath = useGetNavPath();
  const openPath = useCallback(
    (path: SourcePath) => {
      const navPath = (getNavPath(path) ?? path) as SourcePath;
      navigation.navigate(navPath, { scrollToPath: path });
    },
    [navigation, getNavPath],
  );

  /**
   * A pick on the page opens the field it belongs to, or says why it cannot.
   *
   * An element can carry more than one path — a heading built from two fields
   * is one element with two paths — and nothing says which was meant, so the
   * first is opened. The overlay makes the same choice.
   *
   * ## Why this returns something
   *
   * A pick is one act with two halves in two owners: the shell opens the field,
   * because it owns navigation, and the canvas goes to the fields column,
   * because where to LOOK is its business. They used to run one after the other
   * unconditionally, so a pick that could not be opened still moved the whole
   * workspace — on a phone, off the page and onto a fields column that did not
   * contain the field, because the field had not been openable in the first
   * place. That is the state that reads as the studio having broken.
   *
   * So the first half reports whether it happened, and the second half only
   * runs if it did. A pick either lands completely or changes nothing and says
   * why.
   */
  const resolveNavPath = useResolveNavPath();
  const reportError = useReportError();
  const openPickedPath = useCallback(
    (paths: SourcePath[]): boolean => {
      const path = paths[0];
      if (path === undefined) {
        // The page tags an element with at least one path, so an empty list
        // means the two sides disagree about the attribute's format — a version
        // skew between `@valbuild/next` and the studio, most likely.
        reportError(
          "That element on the page has no content behind it",
          "The page reported a selection with no source path. Check that @valbuild/next and @valbuild/ui are on the same version.",
        );
        return false;
      }
      const resolution = resolveNavPath(path);
      if (resolution.status === "resolved") {
        // No assertion: what it resolves to is a module as often as a path
        // inside one — a field whose nearest nav stop is the module root gives
        // the former — and `navigate` takes either. Narrowing it to a
        // `SourcePath` here would be claiming something this does not know.
        navigation.navigate(resolution.path, { scrollToPath: path });
        return true;
      }
      reportError(...describeUnopenablePick(resolution, path));
      return false;
    },
    [navigation, resolveNavPath, reportError],
  );

  /**
   * The running site, in a frame.
   *
   * The site itself rather than a reconstruction of it: the studio is served
   * from the same origin as the app, so the frame renders the real route with
   * the real components — which is the only version of the page worth looking
   * at. `CanvasFrame` owns the rest: preview mode, and the message protocol
   * that lets a page in a different document be part of the editor.
   */
  const renderCanvas = useMemo(() => {
    return ({
      width,
      height,
      reloadKey,
      isPicking,
      onRefreshingChange,
      onPinch,
      onZoom,
      onPicked,
      enableKey,
      onStatusChange,
    }: Parameters<NonNullable<PageWorkspaceProps["renderCanvas"]>>[0]) => (
      <CanvasFrame
        url={canvasUrl}
        width={width}
        height={height}
        reloadKey={reloadKey}
        isPicking={isPicking}
        /*
         * The project's accent, for the outlines drawn on the page itself.
         *
         * Read off `themeStyle` rather than recomputed: those are the very
         * custom properties the rest of the studio resolves its outlines from,
         * so the page and the chrome cannot end up a shade apart. Undefined
         * when the project has no accent, which leaves Val's green.
         */
        selectionColors={canvasSelectionColors}
        /*
         * The field being edited is the one the route points at, so the outline
         * on the page follows the editor without a second source of truth for
         * "what is selected".
         *
         * Only while SELECTING, though. Turning select mode off drops the
         * resting outlines on every editable node, and the one on the selected
         * field used to stay behind — a single box floating on a page that is
         * otherwise back to being a page. Leaving the mode means leaving all of
         * it.
         */
        highlightedPath={isPicking ? focusedPath : null}
        onElements={setCanvasElements}
        /*
         * Two things happen on a pick, and they belong to different owners.
         * The shell opens the field, because it owns navigation; the canvas is
         * told one happened, because where to LOOK afterwards is its business —
         * the fields column, and on a phone the pane that holds it.
         *
         * In that order, and the second only if the first worked. See
         * `openPickedPath`: a workspace moved for a field that never opened is
         * the broken-looking state this used to leave behind.
         */
        onPick={(paths) => {
          if (openPickedPath(paths)) onPicked(paths[0] ?? null);
        }}
        onPinch={onPinch}
        onZoom={onZoom}
        /*
         * Preview mode, both ways. The button that turns it on is in the
         * notice above the canvas - outside the zoom, where a status bar has
         * to be - and the navigation that does it has to happen here, where
         * the frame is. See `CanvasPreviewNotice`.
         */
        enableKey={enableKey}
        onStatusChange={onStatusChange}
        onRefreshingChange={onRefreshingChange}
      />
    );
  }, [canvasUrl, focusedPath, openPickedPath]);

  /**
   * Every field with a validation error, as source paths.
   *
   * The errors view takes the fields it should show rather than reading them
   * itself, because it is also used to review a subset — one module's errors,
   * or the ones that blocked a publish. Navigating there with none shows "No
   * errors selected", which is what happened every time the shell opened it.
   */
  const allValidationErrorPaths = useMemo(
    (): SourcePath[] =>
      validationErrors === undefined
        ? []
        : (Object.keys(validationErrors) as SourcePath[]),
    [validationErrors],
  );

  /** One module's errors, from the row in the utility panel. */
  const onSelectValidationError = useCallback(
    (error: ShellValidationError) => {
      const forModule = allValidationErrorPaths.filter((path) =>
        path.startsWith(error.id),
      );
      navigation.navigate(VAL_ERRORS_ROUTE, {
        errorFields: forModule.length > 0 ? forModule : allValidationErrorPaths,
      });
    },
    [navigation, allValidationErrorPaths],
  );

  /*
   * The Review button goes to the review page, not the compare dialog.
   *
   * Its badge counts this user's pending changes and it sits beside Publish, so
   * it is read as "what am I about to ship" — which is the question the review
   * page answers and the compare view deliberately does not. Compare is one
   * button further in, from the page itself.
   */
  const showReview = useCallback(() => {
    navigation.navigate(VAL_REVIEW_ROUTE);
  }, [navigation]);

  /**
   * Signing out, where there is a session to end.
   *
   * Only in `http` mode. Running against the working copy on disk there is no
   * session at all, so the control is absent rather than present and inert —
   * and a Sign out button that does nothing is worse than none, because the
   * only way to find out is to press it.
   *
   * `/api/val/logout` rather than the app host's: it is this studio's session
   * cookies that decide whether you are signed in here, and the app host's
   * logout does not clear them. `redirect_to` brings you back to where you
   * were, where the studio now finds itself unauthenticated and asks you to
   * sign in — which is what signing out is supposed to look like. It used to
   * point at the app host, which signed you out of Val's own site and left this
   * studio exactly as it was.
   *
   * Not conditional on the profile any more. The profile is a display name and
   * an avatar; it can fail to load (see `profilesError`) while the session it
   * belongs to is perfectly valid, and hiding the way out of a session because
   * its owner's name did not arrive left no way out at all.
   */
  const onSignOut = useMemo(() => {
    if (mode !== "http") return undefined;
    return () => {
      const redirectTo = encodeURIComponent(window.location.href);
      window.location.href = `/api/val/logout?redirect_to=${redirectTo}`;
    };
  }, [mode]);

  /**
   * What the status bar says about saving.
   *
   * A patch that has not reached the server yet is the only thing that means
   * "saving": patches are applied locally first, so the editor is never
   * waiting on a round trip to show your change.
   */
  const rawSaveState: SaveState = useMemo(() => {
    const hasPatchErrors = Object.values(patchErrors ?? {}).some(
      (forModule) => Object.keys(forModule ?? {}).length > 0,
    );
    if (hasPatchErrors || connectionStatus === "service-unavailable") {
      return "error";
    }
    return pendingClientSidePatchIds.length > 0 ? "saving" : "saved";
  }, [patchErrors, connectionStatus, pendingClientSidePatchIds]);
  /** Held through a burst of writes, so typing does not blink the bar. */
  const saveState = useSteadySaveState(rawSaveState);

  const publishState: PublishState = isPublishing ? "publishing" : "idle";

  /*
   * Proposals, where the project has them: the switcher, and in a proposal
   * Save where Publish is. The unsaved count is Review's, for the same reason
   * Review's is what it is: changes that cancel out are nothing to save.
   */
  /*
   * In a proposal, Review is Compare with the site: what Publish -- merging
   * it -- would change, saved and unsaved alike, against what visitors see.
   * The review page lists pending patches, and a proposal's saved changes are
   * not patches the Studio holds.
   */
  const inProposal = useCurrentProposal() !== null;
  const siteChanges = useSiteChanges(inProposal);
  const [siteCompareOpen, setSiteCompareOpen] = useState(false);
  const openSiteCompare = useCallback(() => setSiteCompareOpen(true), []);
  const {
    proposals: proposalsBar,
    dialogs: proposalDialogs,
    notice: proposalNotice,
    restoreDestination,
  } = useProposalsBar({
    unsaved: hasNetChanges ? pendingChangeCount : 0,
    portalContainer,
    onCompare: openSiteCompare,
  });
  // A merged proposal's notice first: it says this whole Studio is finished.
  const shellNotice =
    proposalNotice === null ? (
      editorNotice
    ) : (
      <div className="flex flex-col gap-3">
        {proposalNotice}
        {editorNotice}
      </div>
    );
  const proposals = useMemo(
    () =>
      proposalsBar && inProposal
        ? { ...proposalsBar, onCompare: openSiteCompare }
        : proposalsBar,
    [proposalsBar, inProposal, openSiteCompare],
  );

  /**
   * The real auto-save setting, not one of the shell's own.
   *
   * The shell used to hold its own `useState(true)` for this: a checkbox that
   * showed on, changed nothing when clicked, and disagreed with the setting
   * that actually governs saving, whose default is off.
   */
  const { autoPublish, setAutoPublish } = useAutoPublish();

  /**
   * Something in the editor column that is not a selection.
   *
   * The compare and errors views are the whole column and have no row in the
   * navigation to be selected. A module the navigation has no row for is the
   * third case: a router's own module root is a record of every URL under it,
   * which is not a page and so not a row — and the shell showed "no item
   * selected" for it, which is why the header's link appeared to go nowhere.
   * It is a real module and renders like any other record, so it renders.
   */
  const unlistedModulePath =
    !navigation.isCompareView &&
    !navigation.isErrorsView &&
    !navigation.isHistoryView &&
    !navigation.isReviewView &&
    !navigation.isAdeptView &&
    selectionId === null &&
    navigation.currentSourcePath
      ? (navigation.currentSourcePath as SourcePath)
      : null;
  const overrideEditor = navigation.isCompareView ? (
    <CompareView />
  ) : navigation.isReviewView ? (
    /*
     * What is going out, as the whole editor column.
     *
     * Beside `/val/compare` rather than replacing it, for now: the two answer
     * different questions ("what is going out" and "what changed"), and this
     * one leads to that one by its Compare button.
     */
    <ReviewRoute canPublishSelected={restoreDestination.kind === "proposal"} />
  ) : navigation.isErrorsView ? (
    <ValidateRoute />
  ) : navigation.isHistoryView ? (
    /*
     * The list of publishes, as the whole editor column.
     *
     * Mounted only on this route, so opening the Studio does not fetch a list
     * nobody asked for — the head of it moves on every publish, so it is not
     * cached and there would be nothing to warm. That was the one good
     * property of it being a panel, and a route keeps it.
     */
    <HistoryView />
  ) : navigation.isAdeptView ? (
    // Unlinked: see VAL_ADEPT_ROUTE.
    <AdeptView />
  ) : unlistedModulePath ? (
    <Module path={unlistedModulePath} showModuleGalleryChild={null} />
  ) : null;

  /*
   * History, when a commit is in the URL.
   *
   * The left half is the editor exactly as it is - the shell hands it back to
   * us - so opening history changes what is BESIDE the Studio and nothing about
   * the Studio itself. Under lock (the default) the right pane follows the
   * editor's own path, which is what people want almost every time: they came
   * to compare one field with its older self.
   */
  /*
   * The restore being aimed, shared by both panes.
   *
   * Held here because it spans them: the value is picked on the right and the
   * destination on the left, and neither pane can hold state the other needs.
   * The URL is still the source of truth for WHICH stage we are at — the picked
   * VALUE is carried alongside it because a path alone would mean re-reading the
   * commit to answer every compatibility question.
   */
  const restore = useDirectedRestore(
    commitState?.status === "success" ? commitState.patchSet : undefined,
    restoreDestination,
  );

  const renderHistory = history.commitSha
    ? (
        editor: React.ReactNode,
        breakpoint: "mobile" | "tablet" | "desktop",
      ) => (
        <HistorySplit
          editor={
            <RestoreModeProvider mode={restore.nowMode}>
              {editor}
            </RestoreModeProvider>
          }
          breakpoint={breakpoint}
          commitLabel={`At ${history.commitSha?.slice(0, 7)}`}
          history={
            <HistoryPane
              wrapModule={(module) => (
                <RestoreModeProvider mode={restore.commitMode}>
                  {module}
                </RestoreModeProvider>
              )}
              restoreSlot={
                <RestoreControls
                  patchSet={
                    commitState?.status === "success"
                      ? commitState.patchSet
                      : undefined
                  }
                  path={navigation.currentSourcePath as SourcePath | null}
                  restore={restore}
                />
              }
              patchSet={
                commitState?.status === "success"
                  ? commitState.patchSet
                  : undefined
              }
              path={
                history.locked
                  ? (navigation.currentSourcePath as SourcePath | null)
                  : history.rightPath
              }
              loading={commitState?.status === "loading"}
              error={
                commitState?.status === "error" ? commitState.message : null
              }
            />
          }
        />
      )
    : undefined;

  return (
    <LocaleFilterProvider locale={locale}>
      <Shell
        renderHistory={renderHistory}
        data={data}
        theme={resolvedTheme}
        themeStyle={themeStyle}
        onThemeChange={setTheme}
        mode={mode}
        selectionId={overrideEditor ? null : selectionId}
        onSelectionChange={onSelectionChange}
        renderEditor={renderEditor}
        renderSettings={renderSettings}
        renderExternalPages={renderExternalPages}
        tourEnabled={demo !== null || isTourOffered(studioSettings)}
        buildTourSteps={buildDemoTourSteps}
        autoStartTour={demoTourPending}
        onTourClose={demo !== null ? writeDemoTourSeen : undefined}
        renderDemoBanner={
          demo !== null
            ? (startTour) => (
                <DemoBanner
                  onStartTour={startTour}
                  // The demo's edits live in this page's memory, so a reload
                  // is a reset: there is nothing stored to clear.
                  onReset={() => window.location.reload()}
                />
              )
            : undefined
        }
        editorOverride={overrideEditor}
        notice={shellNotice}
        renderPlanStatus={planStatus}
        statusNotice={remoteFilesStatusNotice}
        publishSlot={demo !== null ? <DemoPublishButton /> : <PublishButton />}
        publishState={publishState}
        publishIndicator={publishIndicatorState}
        saveState={saveState}
        autoSave={autoPublish}
        onAutoSaveChange={demo !== null ? undefined : setAutoPublish}
        pendingChanges={data.pendingChanges ?? 0}
        /*
         * Zeroed when the pending patches cancel out, so Review does not put a
         * number on changes that will not ship. The button itself stays: that
         * view is where Discard is, and Publish is disabled until something
         * changes.
         */
        reviewCount={
          inProposal
            ? siteChanges.status === "ready"
              ? siteChanges.changeCount
              : 0
            : hasNetChanges
              ? pendingChangeCount
              : 0
        }
        /*
         * Offered only once the metadata behind the confirm has arrived.
         *
         * The confirm names the other people whose work would go, and those
         * names come from the patch sets. While those are still grouping the
         * list is empty — so an eager button could throw away a colleague's
         * work having promised, and shown, nothing about it. A row that appears
         * a moment late is the cheaper mistake.
         */
        onDiscardAll={discardAll.enabled ? discardAll.discardAll : undefined}
        discardAllDescription={discardAll.description}
        portalContainer={portalContainer}
        isLoading={state.status === "loading"}
        loadError={state.status === "error" ? state.error : undefined}
        renderCanvas={renderCanvas}
        canvasPaths={canvasPaths}
        onSelectCanvasPath={openPath}
        selectedCanvasPath={focusedPath}
        canvasRoute={canvasUrl}
        onCanvasRouteChange={onCanvasRouteChange}
        canvasRoutes={canvasRoutes}
        initialPanel={urlState.initial.panel}
        locales={projectLocales}
        locale={locale}
        onLocaleChange={setLocale}
        initialCanvasOpen={urlState.initial.canvasOpen}
        initialCanvasView={urlState.initial.canvasView}
        restoreViewState={restoreViewState}
        initialCanvasTransform={urlState.initial.canvasTransform}
        onViewStateChange={setViewState}
        onNewPage={addPage}
        onDuplicatePage={duplicatePage}
        onRenamePage={renamePage}
        // Where the demo cannot relay uploads (see `ValDemoRuntime.uploads`).
        onUploadMedia={demo !== null && !demo.uploads ? undefined : uploadInto}
        onPreview={openPreviewTab}
        // Also as an href, so the menu item is a link that can be copied. The URL
        // enables preview and redirects, so it is worth sending to someone.
        previewHref={previewHref}
        onSelectValidationError={onSelectValidationError}
        onCompare={inProposal ? openSiteCompare : showReview}
        // Recent activity rows did nothing: the panel listed them and no handler
        // was passed. They carry a real source path, so opening one is the same
        // act as opening a search hit.
        onSelectActivity={(entry) => openPath(entry.sourcePath as SourcePath)}
        getMediaFileUrl={getMediaFileUrl}
        searchContentResults={contentSearch.results}
        isSearchingContent={contentSearch.isSearching}
        onSearchQueryChange={setSearchQuery}
        // A content hit is a path inside a module, so it is opened directly.
        onOpenSearchResult={(result) => openPath(result.id as SourcePath)}
        onSignOut={onSignOut}
        accountError={
          profilesError
            ? { message: profilesError.message, onRetry: profilesError.retry }
            : undefined
        }
        aiEnabled={isAIChatEnabled}
        /*
         * The real assistant, not a stand-in.
         *
         * Mounted only while the panel is open — same as the on-page overlay.
         * The socket is not: it belongs to `ValProvider`, so closing the panel
         * does not disconnect, and the conversation comes back because
         * `AIChatSurface` seeds itself from the session id in the URL.
         */
        aiSlot={
          isAIChatEnabled ? <AIChatSurface className="h-full" /> : undefined
        }
        /*
         * Whether to offer History at all.
         *
         * False in FS mode: local dev has git rather than a commit archive, so
         * there is no published history to list and `/history/commits` answers
         * `not-supported-in-fs-mode`. The button is hidden rather than leading
         * to a page whose only content is an apology.
         *
         * And false without a resolved branch, for the same reason rather than
         * a second one: history is listed PER BRANCH, so `HistoryView` has no
         * request to make and says so. The server names the branch it lists
         * -- a proposal's, a git mirror's or a managed project's -- so this
         * is the deployment that has none. Offering the button there is the
         * dead affordance this comment exists to forbid.
         */
        historyEnabled={historyEnabledFor({
          mode,
          historyBranch: shellHistoryBranch,
        })}
        historyActive={navigation.isHistoryView}
        onOpenHistory={() => navigation.navigate(VAL_HISTORY_ROUTE)}
        onOpenValidate={() => navigation.navigate(VAL_ERRORS_ROUTE)}
        validateActive={navigation.isErrorsView}
        validateCount={validateCount}
        onMentionField={(sourcePath) =>
          insertFieldRef(sourcePath as SourcePath)
        }
        // Held until the first load's patches are in — see `PendingChangesGate`.
        pendingChangesLoaded={pendingChangesLoaded}
        pendingChangesProgress={pendingChangesProgress}
        pendingChangesError={pendingChangesError}
        proposals={proposals}
      />
      {proposalDialogs}
      <ProposalSiteCompare
        changes={siteChanges}
        open={siteCompareOpen}
        onOpenChange={setSiteCompareOpen}
        portalContainer={portalContainer}
      />
      {handoff.state !== null && handoffCardInStudio(handoff.state) && (
        /*
         * A publish this Studio handed to a builder tab, because it cannot
         * build here -- only when something needs doing about it: the tab was
         * blocked, or it failed. While it builds, the status bar's indicator
         * says so, with the tab's step; once it is content's, this Studio's
         * own indicator and toast follow it. See `handoffCardInStudio`.
         */
        <div className={cn("fixed right-4 z-window", CLEAR_OF_BOTTOM_BARS)}>
          <PublishHandoffCard
            state={handoff.state}
            onReload={() => window.location.reload()}
            onOpenStudio={handoff.openStudio}
            onDismiss={
              handoff.state.kind === "opening" ||
              handoff.state.kind === "running"
                ? undefined
                : handoff.dismiss
            }
          />
        </div>
      )}
    </LocaleFilterProvider>
  );
}

/**
 * The `/val/history` page: the commit list, wired up.
 *
 * Separated from `ValShell` so the fetch lives with the thing that shows it —
 * and so it unmounts with the route, which is what keeps the list from being
 * fetched on every Studio load.
 *
 * Picking a commit here sets `?commit=` and the two-pane view opens over
 * whatever the editor is on. That is the same layering the panel had: history
 * is a LAYER over a route, and this page is only the place you pick from.
 */
function HistoryView() {
  const config = useValConfig();
  const { history, setHistory } = useHistoryParams();
  const branch = useHistoryBranch();
  const { state, loadMore } = useCommitList(branch);
  /*
   * History is listed per branch, and the server names none for a project
   * with no history to list. Said out loud rather than left as a spinner: the
   * hook has no request to make, so it would otherwise sit on "Reading the
   * history…" forever. `config` being undefined is the different, transient
   * case - it is still loading - and keeps the spinner.
   */
  if (config !== undefined && branch === null) {
    return (
      <PanelEmptyState>
        This project has no history to show here. History is listed per branch,
        and this deployment names none: set <code>gitBranch</code> in{" "}
        <code>val.config</code> if it publishes to git.
      </PanelEmptyState>
    );
  }
  return (
    <CommitList
      state={state}
      selectedCommitSha={history.commitSha}
      onSelect={(commitSha) =>
        /*
         * Locked, and with no restore in progress.
         *
         * Picking a different commit from the list is starting again, not
         * continuing: carrying a half-aimed restore across would leave a source
         * path pointing into a commit that is no longer on screen.
         */
        setHistory({
          commitSha,
          locked: true,
          rightPath: null,
          restore: { mode: "off" },
        })
      }
      onStopComparing={() =>
        setHistory({
          commitSha: null,
          locked: true,
          rightPath: null,
          restore: { mode: "off" },
        })
      }
      onLoadMore={loadMore}
    />
  );
}

/** The compare view, in the editor column. */
function CompareView() {
  const val = useValSystem();
  /**
   * Everything typed reaches the server before the comparison is computed.
   *
   * A field writes on a pause in typing, so clicking Compare a moment after
   * editing could group a chain that is missing the last word — and the view
   * would then show a diff that is not the one about to be published. Once, on
   * mount: the grouping is re-read whenever the chain moves, so the save landing
   * brings it in.
   */
  useEffect(() => {
    if (val === null) return;
    void val.system.patchSync.flush();
  }, [val]);
  const patchSetsResult = usePatchSets();
  const profilesByAuthorIds = useProfilesByAuthorId();
  const mode = useValMode();
  // A publish commits the patches this view is diffing and moves the base they
  // are diffed against, so the rendered comparison is stale as soon as one goes
  // through: rebuild it instead of leaving the pre-publish diff on screen.
  const publishCount = usePublishCount();
  if (patchSetsResult.status === "not-asked") {
    return <CompareLoading />;
  }
  if (patchSetsResult.status === "error") {
    return (
      <div className="text-sm text-fg-error-on-surface py-8 text-center">
        Failed to load changes: {patchSetsResult.error}
      </div>
    );
  }
  return (
    <ComparePatchSets
      patchSets={patchSetsResult.data}
      profilesByAuthorIds={profilesByAuthorIds}
      mode={mode}
      canDiscard
      reloadKey={publishCount}
    />
  );
}

/**
 * `/val/review`, wired to the same patch sets the compare view diffs.
 *
 * The flush is the same one `CompareView` does and for the same reason: a
 * field writes on a pause in typing, so arriving here a moment after editing
 * could list a chain that is missing the last word — and this page's whole job
 * is to be the truth about what is going out.
 */
function ReviewRoute({
  canPublishSelected,
}: {
  /** On the site of a project with proposals: see `ReviewSurface`. */
  canPublishSelected: boolean;
}) {
  const val = useValSystem();
  useEffect(() => {
    if (val === null) return;
    void val.system.patchSync.flush();
  }, [val]);
  const navigation = useNavigation();
  const portalContainer = useValPortal();
  const discardAll = useDiscardAll();
  const mode = useValMode();
  /*
   * The branch history is listed under. Read here as well as in the shell
   * because Restore and the History button are two doors to one page, and a
   * door that opens onto an apology should not be there.
   */
  const reviewHistoryBranch = useHistoryBranch();
  return (
    <ReviewLoader>
      {(patchSets) => (
        <ReviewSurface
          patchSets={patchSets}
          /*
           * The same test the top bar's History button uses, from the same
           * function — see `historyEnabledFor` for why the two doors to
           * that page cannot be allowed to answer differently.
           */
          onRestore={
            historyEnabledFor({ mode, historyBranch: reviewHistoryBranch })
              ? () => navigation.navigate(VAL_HISTORY_ROUTE)
              : undefined
          }
          /*
           * Only while there is something a revert could take back. Same
           * test the shell's own Discard all uses — a committed patch is in
           * a commit and cannot be dropped from here, so a page whose rows
           * have all shipped would otherwise offer a button that confirms
           * and does nothing.
           */
          onDiscardAll={discardAll.enabled ? discardAll.discardAll : undefined}
          discardAllDescription={discardAll.description}
          canPublishSelected={canPublishSelected}
          portalContainer={portalContainer}
        />
      )}
    </ReviewLoader>
  );
}

/**
 * Which row the current route belongs to.
 *
 * Exported for the test: this is the one place where a route that is not
 * exactly a row's id still has to resolve to that row, and getting it wrong
 * shows up as a navigation that selects nothing.
 */
export function resolveSelectionId(
  data: ShellData,
  currentSourcePath: string,
): string | null {
  if (!currentSourcePath) return null;
  let best: string | null = null;
  const consider = (id: string) => {
    if (!isPathWithin(currentSourcePath, id)) return;
    if (best === null || id.length > best.length) best = id;
  };
  const walkPages = (pages: ShellData["pages"]) => {
    for (const page of pages) {
      if (page.sourcePath !== undefined) consider(page.id);
      walkPages(page.children ?? []);
    }
  };
  walkPages(data.pages);
  for (const external of data.externalPages) {
    if (external.sourcePath !== undefined) consider(external.id);
  }
  for (const gallery of data.media) consider(gallery.id);
  for (const module of data.data) consider(module.id);
  return best;
}

/**
 * What to tell someone whose click on the page opened nothing.
 *
 * The failure is entirely invisible from where they are standing: the thing
 * they pointed at is right there on the page, drawn by the app, outlined by
 * Val. Every one of these has a different next step, which is the reason they
 * are told apart at all — and the details line carries the path, because the
 * person who can act on two of the three is a developer reading it over their
 * shoulder.
 */
function describeUnopenablePick(
  resolution: Exclude<NavPathResolution, { status: "resolved" }>,
  path: SourcePath,
): [message: string, details: string] {
  if (resolution.status === "schemas-not-loaded") {
    return [
      "Still loading — try that again in a moment",
      `The content schema had not arrived yet, so ${path} could not be opened.`,
    ];
  }
  if (resolution.status === "module-not-loaded") {
    return [
      "That field's content file is not loaded",
      `The page points at ${resolution.moduleFilePath}, which the studio does not have. It may have been deleted or renamed since the page was built.`,
    ];
  }
  return [
    "That field is no longer where the page says it is",
    `${path} does not resolve in ${resolution.moduleFilePath}: ${resolution.reason}. The page is probably rendering content from before a change to the schema — reload the canvas.`,
  ];
}

/**
 * What the shell renders before the navigation has loaded.
 *
 * The shell needs a `ShellData` to render its chrome at all, and showing the
 * chrome with empty panels is the point of its loading state — the alternative
 * is a blank screen while the first request is in flight.
 */
const EMPTY_SHELL_DATA: ShellData = {
  projectName: "Val",
  // Unknown rather than false, but the shell only reads this once loading is
  // over — `isLoading` puts every destination on the rail until then.
  hasRouters: false,
  pages: [],
  externalPages: [],
  media: [],
  data: [],
  validationErrors: [],
};
