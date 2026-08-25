import { useCallback, useMemo } from "react";
import { SourcePath } from "@valbuild/core";
import { DEFAULT_APP_HOST } from "@valbuild/core";
import { findShellSelection, Shell, ShellSelection } from "./Shell";
import { SaveState } from "./StatusBar";
import { PublishState } from "./TopBar";
import { ShellData, ShellValidationError } from "./types";
import { useShellData } from "./useShellData";
import { Module } from "../Module";
import { PublishButton } from "../PublishButton";
import { ValidationErrorsView } from "../ValidationErrors";
import { ComparePatchSets, CompareLoading } from "../ComparePatchSets";
import { LoginDialog } from "../LoginDialog";
import { PatchErrorsDialog } from "../PatchErrorsDialog";
import { TransientErrorToasts } from "../TransientErrorToasts";
import { Toaster } from "../designSystem/sonner";
import { useTheme } from "../ValThemeProvider";
import { VAL_ERRORS_ROUTE, useNavigation } from "../ValRouter";
import {
  useAllPatchErrors,
  useAuthenticationState,
  useConnectionStatus,
  useCurrentProfile,
  usePatchSets,
  usePendingClientSidePatchIds,
  useProfilesByAuthorId,
  usePublishCount,
  usePublishSummary,
  useValMode,
} from "../ValProvider";
import { useValConfig } from "../ValFieldProvider";

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

  if (authenticationState === "login-required") {
    return (
      <div className="min-h-[100svh] bg-bg-primary">
        <LoginDialog />
      </div>
    );
  }

  return (
    <>
      <ValShellBody state={shellData} />
      <Toaster />
      <TransientErrorToasts />
      <PatchErrorsDialog />
    </>
  );
}

/**
 * Split from `ValShell` so the login gate above returns before any of these
 * hooks run: a signed-out session has no profile, no patch sets and no
 * navigation to load, and asking for them only produces failing requests
 * behind the login dialog.
 */
function ValShellBody({ state }: { state: ReturnType<typeof useShellData> }) {
  const { theme, setTheme } = useTheme();
  const config = useValConfig();
  const mode = useValMode();
  const profile = useCurrentProfile();
  const navigation = useNavigation();
  const connectionStatus = useConnectionStatus();
  const pendingClientSidePatchIds = usePendingClientSidePatchIds();
  const { patchErrors } = useAllPatchErrors();
  const { isPublishing } = usePublishSummary();

  const data: ShellData =
    state.status === "success" ? state.data : EMPTY_SHELL_DATA;

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

  const renderEditor = useCallback(
    (selection: ShellSelection) => (
      <Module
        path={selection.sourcePath as SourcePath}
        showModuleGalleryChild={null}
      />
    ),
    [],
  );

  /**
   * The page the canvas is currently on, if it is on one.
   *
   * Only a page selection has a URL to show, and only one Val resolves — the
   * canvas is a view of a route, so a data module or a gallery has nothing to
   * put on it.
   */
  const canvasUrl =
    selection?.kind === "page" && selection.isTracked === true
      ? selection.urlPath
      : null;

  /**
   * The running site, in a frame.
   *
   * The site itself rather than a reconstruction of it: the studio is served
   * from the same origin as the app, so the frame renders the real route with
   * the real components — which is the only version of the page worth looking
   * at. It also means the frame inherits Val's own cookie, so it renders in
   * whatever mode the app is already in rather than needing a mode of its own.
   *
   * `key` on the URL because a frame does not navigate when its `src` changes
   * in place as reliably as it remounts, and a canvas showing the previous
   * page is worse than one showing nothing.
   *
   * The frame is not yet wired to the editor: selecting a field does not
   * highlight it here, and editing does not update it live. Both need the page
   * to report what is on it, which is the next piece of work rather than
   * something to fake in the meantime.
   */
  const renderCanvas = useMemo(() => {
    if (canvasUrl === null) return undefined;
    return ({ width, height }: { width: number; height: number }) => (
      <iframe
        key={canvasUrl}
        src={canvasUrl}
        title={`Preview of ${canvasUrl}`}
        style={{ width, height, border: "none", background: "white" }}
        // The frame is our own app on our own origin, so it needs no
        // sandboxing beyond what the browser already applies; naming the
        // referrer policy keeps it from leaking the studio's URL outward if
        // the page ever follows a link off-site.
        referrerPolicy="same-origin"
      />
    );
  }, [canvasUrl]);

  const onSelectValidationError = useCallback(
    (error: ShellValidationError) => {
      navigation.navigate(error.id as SourcePath);
    },
    [navigation],
  );

  const showErrors = useCallback(() => {
    navigation.navigate(VAL_ERRORS_ROUTE);
  }, [navigation]);

  /**
   * Signing out is a link to the app host, and only exists in `http` mode:
   * there is no session to end when Val is reading and writing the working
   * copy on disk.
   */
  const onSignOut = useMemo(() => {
    if (mode !== "http" || !profile) return undefined;
    const appHostUrl = config?.appHost || DEFAULT_APP_HOST;
    return () => {
      window.location.href = `${appHostUrl}/logout`;
    };
  }, [mode, profile, config?.appHost]);

  /**
   * What the status bar says about saving.
   *
   * A patch that has not reached the server yet is the only thing that means
   * "saving": patches are applied locally first, so the editor is never
   * waiting on a round trip to show your change.
   */
  const saveState: SaveState = useMemo(() => {
    const hasPatchErrors = Object.values(patchErrors ?? {}).some(
      (forModule) => Object.keys(forModule ?? {}).length > 0,
    );
    if (hasPatchErrors || connectionStatus === "service-unavailable") {
      return "error";
    }
    return pendingClientSidePatchIds.length > 0 ? "saving" : "saved";
  }, [patchErrors, connectionStatus, pendingClientSidePatchIds]);

  const publishState: PublishState = isPublishing ? "publishing" : "idle";

  // The compare and errors views are not a selection: they are the whole
  // editor column, and they have no row in the navigation to be selected.
  const overrideEditor = navigation.isCompareView ? (
    <CompareView />
  ) : navigation.isErrorsView ? (
    <ValidationErrorsView />
  ) : null;

  return (
    <Shell
      data={data}
      theme={theme === "light" ? "light" : "dark"}
      onThemeChange={setTheme}
      selectionId={overrideEditor ? null : selectionId}
      onSelectionChange={onSelectionChange}
      renderEditor={renderEditor}
      editorOverride={overrideEditor}
      publishSlot={<PublishButton />}
      publishState={publishState}
      saveState={saveState}
      pendingChanges={data.pendingChanges ?? 0}
      isLoading={state.status === "loading"}
      loadError={state.status === "error" ? state.error : undefined}
      renderCanvas={renderCanvas}
      onShowErrors={showErrors}
      onSelectValidationError={onSelectValidationError}
      onSignOut={onSignOut}
    />
  );
}

/** The compare view, as `ContentArea` renders it. */
function CompareView() {
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
      <div className="text-sm text-fg-error py-8 text-center">
        Failed to load changes: {patchSetsResult.error}
      </div>
    );
  }
  return (
    <ComparePatchSets
      patchSets={patchSetsResult.data}
      profilesByAuthorIds={profilesByAuthorIds}
      mode={mode}
      readonly={false}
      reloadKey={publishCount}
    />
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
 * Whether `path` is `id` or something inside it.
 *
 * A prefix test alone is not enough: `/content/authors.val.ts` is a textual
 * prefix of `/content/authorsExtra.val.ts`, and a page id ending in a quoted
 * route key is a prefix of a longer key that merely starts the same way
 * (`?p="/blog"` and `?p="/blogs"`). The next character therefore has to be one
 * that actually starts a new segment.
 */
function isPathWithin(path: string, id: string): boolean {
  if (path === id) return true;
  if (!path.startsWith(id)) return false;
  const next = path[id.length];
  return next === "?" || next === ".";
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
  pages: [],
  externalPages: [],
  media: [],
  data: [],
  validationErrors: [],
};
