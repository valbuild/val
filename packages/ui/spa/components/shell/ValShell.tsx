import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SourcePath } from "@valbuild/core";
import { ValCanvasElement } from "@valbuild/shared/internal";
import { DEFAULT_APP_HOST } from "@valbuild/core";
import { findShellSelection, Shell, ShellSelection } from "./Shell";
import { CanvasFrame } from "./canvas/CanvasFrame";
import { SaveState } from "./StatusBar";
import { PublishState } from "./TopBar";
import { ShellData, ShellValidationError } from "./types";
import { useShellData } from "./useShellData";
import { useContentSearch } from "./useContentSearch";
import {
  ShellUrlState,
  useShellUrlState,
  useWriteShellUrlState,
} from "./useShellUrlState";
import { Module } from "../Module";
import { PublishButton } from "../PublishButton";
import { ValidationErrorsView } from "../ValidationErrors";
import { ComparePatchSets, CompareLoading } from "../ComparePatchSets";
import { LoginDialog } from "../LoginDialog";
import { PatchErrorsDialog } from "../PatchErrorsDialog";
import { TransientErrorToasts } from "../TransientErrorToasts";
import { Toaster } from "../designSystem/sonner";
import { useTheme } from "../ValThemeProvider";
import {
  VAL_COMPARE_ROUTE,
  VAL_ERRORS_ROUTE,
  useNavigation,
} from "../ValRouter";
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
import { useAllValidationErrors } from "../ValErrorProvider";

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
  const validationErrors = useAllValidationErrors();
  // The query the search overlay is showing, so the content index can answer
  // it. Held here because the overlay is presentational and the index is not.
  const [searchQuery, setSearchQuery] = useState("");
  const contentSearch = useContentSearch(searchQuery);

  /**
   * The view state, from the URL and back into it.
   *
   * Read once on mount — that is what a link restores — and written back as it
   * changes, so the address bar is always a link to what is on screen.
   */
  const urlState = useShellUrlState();
  const [viewState, setViewState] = useState<
    Omit<ShellUrlState, "canvasRoute">
  >(() => ({
    panel: urlState.initial.panel,
    canvasOpen: urlState.initial.canvasOpen,
    canvasView: urlState.initial.canvasView,
    canvasTransform: urlState.initial.canvasTransform,
  }));
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
   * The page the canvas is currently on, if it is on one.
   *
   * Only a page selection has a URL to show, and only one Val resolves — the
   * canvas is a view of a route, so a data module or a gallery has nothing to
   * put on it.
   */
  const selectedPageUrl = selection?.kind === "page" ? selection.urlPath : null;

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
  }, [selectedPageUrl]);

  const canvasUrl = typedRoute ?? selectedPageUrl;

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
        canvasRoute:
          typedRoute !== null && typedRoute !== selectedPageUrl
            ? typedRoute
            : null,
      }),
      [viewState, typedRoute, selectedPageUrl],
    ),
  );

  /** The routes Val resolves, for the address bar's suggestions. */
  const canvasRoutes = useMemo(() => {
    const routes: string[] = [];
    const walk = (pages: ShellData["pages"]) => {
      for (const page of pages) {
        // A row with no source path is a path segment, not a page: there is
        // nothing at that URL to look at.
        if (page.sourcePath !== undefined) routes.push(page.urlPath);
        walk(page.children ?? []);
      }
    };
    walk(data.pages);
    return routes;
  }, [data.pages]);

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
  const openPreviewTab = useCallback(() => {
    if (canvasUrl === null) return;
    const target = new URL(canvasUrl, window.location.origin).toString();
    window.open(
      `/api/val/enable?redirect_to=${encodeURIComponent(target)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [canvasUrl]);

  /** Open one field, from the page or from the list beside it. */
  const openPath = useCallback(
    (path: SourcePath) => {
      navigation.navigate(path, { scrollToPath: path });
    },
    [navigation],
  );

  /**
   * A pick on the page opens the field it belongs to.
   *
   * An element can carry more than one path — a heading built from two fields
   * is one element with two paths — and nothing says which was meant, so the
   * first is opened. The overlay makes the same choice.
   */
  const onPick = useCallback(
    (paths: SourcePath[]) => {
      const first = paths[0];
      if (first !== undefined) openPath(first);
    },
    [openPath],
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
    if (canvasUrl === null) return undefined;
    return ({
      width,
      height,
      reloadKey,
      isPicking,
      onRequestReload,
    }: {
      width: number;
      height: number;
      reloadKey: number;
      isPicking: boolean;
      onRequestReload: () => void;
    }) => (
      <CanvasFrame
        url={canvasUrl}
        width={width}
        height={height}
        reloadKey={reloadKey}
        isPicking={isPicking}
        // The field being edited is the one the route points at, so the
        // outline on the page follows the editor without a second source of
        // truth for "what is selected".
        highlightedPath={navigation.currentSourcePath || null}
        onElements={setCanvasElements}
        onPick={onPick}
        onRequestReload={onRequestReload}
      />
    );
  }, [canvasUrl, navigation.currentSourcePath, onPick]);

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

  const showErrors = useCallback(() => {
    navigation.navigate(VAL_ERRORS_ROUTE, {
      errorFields: allValidationErrorPaths,
    });
  }, [navigation, allValidationErrorPaths]);

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

  const showCompare = useCallback(() => {
    navigation.navigate(VAL_COMPARE_ROUTE);
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
      mode={mode}
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
      canvasPaths={canvasPaths}
      onSelectCanvasPath={openPath}
      canvasRoute={canvasUrl ?? undefined}
      onCanvasRouteChange={setTypedRoute}
      canvasRoutes={canvasRoutes}
      initialPanel={urlState.initial.panel}
      initialCanvasOpen={urlState.initial.canvasOpen}
      initialCanvasView={urlState.initial.canvasView}
      initialCanvasTransform={urlState.initial.canvasTransform}
      onViewStateChange={setViewState}
      onPreview={openPreviewTab}
      onShowErrors={showErrors}
      onSelectValidationError={onSelectValidationError}
      onCompare={showCompare}
      searchContentResults={contentSearch.results}
      isSearchingContent={contentSearch.isSearching}
      onSearchQueryChange={setSearchQuery}
      // A content hit is a path inside a module, so it is opened directly.
      onOpenSearchResult={(result) => openPath(result.id as SourcePath)}
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
