import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { ValCanvasElement } from "@valbuild/shared/internal";
import { DEFAULT_APP_HOST } from "@valbuild/core";
import { findShellSelection, Shell, ShellSelection } from "./Shell";
import { CanvasFrame } from "./canvas/CanvasFrame";
import { SaveState } from "./StatusBar";
import { PublishState } from "./TopBar";
import { ShellData, ShellMediaGallery, ShellValidationError } from "./types";
import { useShellData } from "./useShellData";
import { useContentSearch } from "./useContentSearch";
import {
  ShellUrlState,
  useShellUrlState,
  useWriteShellUrlState,
} from "./useShellUrlState";
import { Module } from "../Module";
import { useRequestUpload } from "../UploadRequest";
import { useAddPage } from "../useAddPage";
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
  scrollToStudioPath,
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
import {
  useFilePatchIds,
  useGetNavPath,
  useValConfig,
} from "../ValFieldProvider";
import { refToUrl } from "../MediaPicker/refToUrl";
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
        // No breadcrumb or title beside the canvas: the address bar says which
        // route this is and the page itself carries its own heading.
        hideHeader={viewState.canvasOpen}
      />
    ),
    [navigation.currentSourcePath, viewState.canvasOpen],
  );

  /**
   * The route the canvas follows the selection to.
   *
   * A page selection is a router entry, and a route pointing anywhere inside
   * one resolves back to that entry — see `resolveSelectionId` — so "on a route,
   * or somewhere under one" is exactly a page selection.
   *
   * Anything else leaves the canvas where it is, and the root is where it
   * starts. Editing a settings module or a gallery is precisely when watching
   * the page that renders it is worth having, so a selection that is not a page
   * must not yank the canvas away from the page you opened it to watch; and
   * before any page has been opened the canvas still has to show something,
   * because it is a browser and a browser opens somewhere.
   *
   * The last route is kept in a ref rather than in state because it is derived:
   * it changes exactly when `selectedPageRoute` does, so putting it in state
   * would re-render to reach a value this render already knows.
   */
  const selectedPageRoute =
    selection?.kind === "page" ? selection.urlPath : null;
  const lastPageRoute = useRef("/");
  if (selectedPageRoute !== null) {
    lastPageRoute.current = selectedPageRoute;
  }
  const selectedRoute = selectedPageRoute ?? lastPageRoute.current;

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
  }, [selectedRoute]);

  /** Never null: without a route of its own the canvas shows the root. */
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
        canvasRoute:
          typedRoute !== null && typedRoute !== selectedRoute
            ? typedRoute
            : null,
      }),
      [viewState, typedRoute, selectedRoute],
    ),
  );

  /** The routes Val resolves, for the address bar's suggestions. */
  const canvasRoutes = useMemo(() => {
    /**
     * Deduplicated and sorted, both of which matter.
     *
     * Two rows can resolve to the same URL — a router entry and a folder row
     * that stands for it — and the walk would then list it twice. A duplicate is
     * not merely untidy: the address bar keys its options by route, so two
     * options with the same key make React reuse one of them for the other's
     * handler, and picking a route can commit its neighbour.
     *
     * Sorted because insertion order is tree order, which puts `/blogs/blog1`
     * and `/blogs/blog-2` in whatever order the router happened to enumerate
     * them. A list you are scanning for a URL should be in URL order.
     */
    const routes = new Set<string>();
    const walk = (pages: ShellData["pages"]) => {
      for (const page of pages) {
        // A row with no source path is a path segment, not a page: there is
        // nothing at that URL to look at.
        if (page.sourcePath !== undefined) routes.add(page.urlPath);
        walk(page.children ?? []);
      }
    };
    walk(data.pages);
    return Array.from(routes).sort((a, b) => a.localeCompare(b));
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
    const target = new URL(canvasUrl, window.location.origin).toString();
    window.open(
      `/api/val/enable?redirect_to=${encodeURIComponent(target)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [canvasUrl]);

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
    return ({
      width,
      height,
      reloadKey,
      isPicking,
      onRequestReload,
      onRefreshingChange,
    }: {
      width: number;
      height: number;
      reloadKey: number;
      isPicking: boolean;
      onRequestReload: () => void;
      onRefreshingChange: (isRefreshing: boolean) => void;
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
        highlightedPath={focusedPath}
        onElements={setCanvasElements}
        onPick={onPick}
        onRequestReload={onRequestReload}
        onRefreshingChange={onRefreshingChange}
      />
    );
  }, [canvasUrl, focusedPath, onPick]);

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
    selectionId === null &&
    navigation.currentSourcePath
      ? (navigation.currentSourcePath as SourcePath)
      : null;
  const overrideEditor = navigation.isCompareView ? (
    <CompareView />
  ) : navigation.isErrorsView ? (
    <ValidationErrorsView />
  ) : unlistedModulePath ? (
    <Module
      path={unlistedModulePath}
      showModuleGalleryChild={null}
      hideHeader={viewState.canvasOpen}
    />
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
      selectedCanvasPath={focusedPath}
      canvasRoute={canvasUrl}
      onCanvasRouteChange={setTypedRoute}
      canvasRoutes={canvasRoutes}
      initialPanel={urlState.initial.panel}
      initialCanvasOpen={urlState.initial.canvasOpen}
      initialCanvasView={urlState.initial.canvasView}
      initialCanvasTransform={urlState.initial.canvasTransform}
      onViewStateChange={setViewState}
      onNewPage={addPage}
      onUploadMedia={uploadInto}
      onPreview={openPreviewTab}
      onShowErrors={showErrors}
      onSelectValidationError={onSelectValidationError}
      onCompare={showCompare}
      getMediaFileUrl={getMediaFileUrl}
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
  // Unknown rather than false, but the shell only reads this once loading is
  // over — `isLoading` puts every destination on the rail until then.
  hasRouters: false,
  pages: [],
  externalPages: [],
  media: [],
  data: [],
  validationErrors: [],
};
