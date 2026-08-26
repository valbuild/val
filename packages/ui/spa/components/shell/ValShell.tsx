import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { ValCanvasElement } from "@valbuild/shared/internal";
import { findShellSelection, Shell, ShellSelection } from "./Shell";
import { CanvasFrame } from "./canvas/CanvasFrame";
import { canvasFallbackRoute } from "./canvasFallbackRoute";
import { SaveState } from "./StatusBar";
import { PublishState } from "./TopBar";
import { ShellData, ShellMediaGallery, ShellValidationError } from "./types";
import { useShellData } from "./useShellData";
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
  useProfilesError,
  useAIConnectionError,
  usePatchSets,
  usePendingClientSidePatchIds,
  useProfilesByAuthorId,
  usePublishCount,
  usePublishSummary,
  useInitialPatchesApplied,
  useValMode,
} from "../ValProvider";
import { useFilePatchIds, useGetNavPath } from "../ValFieldProvider";
import { refToUrl } from "../MediaPicker/refToUrl";
import { useAllValidationErrors } from "../ValErrorProvider";
import { useAIChatActions } from "../AIChatActionsContext";

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
  /** Why the assistant is unavailable, once it has stopped trying to connect. */
  const aiConnectionError = useAIConnectionError();
  /**
   * Whether there is an assistant at all.
   *
   * `ai.chat.experimental.enable` in the project config. Not the connection —
   * a configured assistant that is currently offline still gets its panel,
   * which is where `aiConnectionError` and its retry are shown.
   */
  const { isAIChatEnabled } = useAIChatActions();
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
  /**
   * Whether the fields can be trusted yet.
   *
   * Latched once — see `useInitialPatchesApplied`: on the first paint a field
   * may be showing published content while the pending change to it is still on
   * its way, and an editor typing over that "fixes" something that was never
   * wrong.
   */
  const pendingChangesLoaded = useInitialPatchesApplied();

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
    };
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);

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
        canvasRoute:
          typedRoute !== null && typedRoute !== selectedRoute
            ? typedRoute
            : null,
      }),
      [viewState, typedRoute, selectedRoute],
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
      onCanvasRouteChange={onCanvasRouteChange}
      canvasRoutes={canvasRoutes}
      initialPanel={urlState.initial.panel}
      initialCanvasOpen={urlState.initial.canvasOpen}
      initialCanvasView={urlState.initial.canvasView}
      restoreViewState={restoreViewState}
      initialCanvasTransform={urlState.initial.canvasTransform}
      onViewStateChange={setViewState}
      onNewPage={addPage}
      onUploadMedia={uploadInto}
      onPreview={openPreviewTab}
      // Also as an href, so the menu item is a link that can be copied. The URL
      // enables preview and redirects, so it is worth sending to someone.
      previewHref={previewHref}
      onShowErrors={showErrors}
      onSelectValidationError={onSelectValidationError}
      onCompare={showCompare}
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
      // Held until the first load's patches are in — see `PendingChangesGate`.
      pendingChangesLoaded={pendingChangesLoaded}
      aiUnavailable={
        aiConnectionError
          ? {
              message: aiConnectionError.message,
              onRetry: aiConnectionError.retry,
            }
          : undefined
      }
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
