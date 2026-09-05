import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { ValCanvasElement } from "@valbuild/shared/internal";
import { findShellSelection, Shell, ShellSelection } from "./Shell";
import type { PageWorkspaceProps } from "./canvas/PageWorkspace";
import { CanvasFrame } from "./canvas/CanvasFrame";
import { canvasFallbackRoute } from "./canvasFallbackRoute";
import { SaveState } from "./StatusBar";
import { PublishState } from "./TopBar";
import { ShellData, ShellMediaGallery, ShellValidationError } from "./types";
import { useShellData } from "./useShellData";
import { discardAllDescription } from "../discardAllDescription";
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
import { PublishButton } from "../PublishButton";
import { ValidationErrorsView } from "../ValidationErrors";
import { ComparePatchSets, CompareLoading } from "../ComparePatchSets";
import { LoginDialog } from "../LoginDialog";
import { PatchErrorsDialog } from "../PatchErrorsDialog";
import { GlobalErrors } from "../GlobalErrors";
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
  usePatchSets,
  usePendingClientSidePatchIds,
  useProfilesByAuthorId,
  usePublishCount,
  usePublishSummary,
  useCommittedPatches,
  useCurrentAuthorId,
  useCurrentPatchIds,
  useDeletePatches,
  useHasNetChanges,
  useInitialPatchesApplied,
  usePatchFetchError,
  usePendingChangesProgress,
  useValMode,
  useAutoPublish,
  useReportError,
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
  /**
   * Whether there is an assistant at all.
   *
   * `ai.chat.experimental.enable` in the project config. Not the connection —
   * a configured assistant that is currently offline still gets its panel,
   * which is where `aiConnectionError` and its retry are shown.
   */
  const { isAIChatEnabled, setOpenAIChatImpl } = useAIChatActions();
  const insertFieldRef = useInsertFieldRef();
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
  const hasNetChanges = useHasNetChanges();
  const { deletePatches } = useDeletePatches();
  const currentPatchIds = useCurrentPatchIds();
  const committedPatchIds = useCommittedPatches();
  const patchSets = usePatchSets();
  const profilesByAuthorIds = useProfilesByAuthorId();
  const currentAuthorId = useCurrentAuthorId();
  const portalContainer = useValPortal();
  /*
   * Everything discardable: the chain minus what has already shipped.
   *
   * A committed patch cannot be taken back from here — it is in a commit —
   * and including one would make the count promise more than it can do. Same
   * subtraction `useShellData` does for `pendingChanges`, so the number in the
   * confirm matches the number on the row that opened it.
   */
  const discardablePatchIds = useMemo(
    () => currentPatchIds.filter((patchId) => !committedPatchIds.has(patchId)),
    [currentPatchIds, committedPatchIds],
  );
  /*
   * Whose work Discard all would take, named — yours excluded.
   *
   * The confirm in the review view names them, and this one has to name the
   * same people: a destructive action that warns you in one place and not the
   * other is worse than one that never warns at all. Read off the patch sets
   * rather than the activity feed, which is capped for display.
   *
   * `currentAuthorId` comes out because the sentence is about work that is not
   * yours. Your own name in it is noise at best, and at worst it is what makes
   * a project where you are the only editor read as if someone else had a stake
   * in the changes.
   */
  const discardAuthorNames = useMemo(() => {
    if (patchSets.status !== "success") return [];
    const discardable = new Set<string>(discardablePatchIds);
    const authorIds = new Set<string>();
    for (const set of patchSets.data) {
      for (const patch of set.patches) {
        if (
          patch.author !== null &&
          patch.author !== currentAuthorId &&
          discardable.has(patch.patchId)
        ) {
          authorIds.add(patch.author);
        }
      }
    }
    return [...authorIds]
      .map((id) => profilesByAuthorIds?.[id]?.fullName)
      .filter((name): name is string => !!name);
  }, [patchSets, discardablePatchIds, profilesByAuthorIds, currentAuthorId]);
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
  /**
   * Copy a page to another URL, and open the copy.
   *
   * The router module IS the record, so the two URLs are the two keys and the
   * copy is one `copy` op - see `useDuplicateRecordEntry`, which the page's own
   * toolbar goes through as well.
   */
  const duplicatePage = useDuplicatePage();

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
      onRequestReload,
      onRefreshingChange,
      onPinch,
      onZoom,
      onPicked,
    }: Parameters<NonNullable<PageWorkspaceProps["renderCanvas"]>>[0]) => (
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
          if (openPickedPath(paths)) onPicked();
        }}
        onPinch={onPinch}
        onZoom={onZoom}
        onRequestReload={onRequestReload}
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
    selectionId === null &&
    navigation.currentSourcePath
      ? (navigation.currentSourcePath as SourcePath)
      : null;
  const overrideEditor = navigation.isCompareView ? (
    <CompareView />
  ) : navigation.isErrorsView ? (
    <ValidationErrorsView />
  ) : unlistedModulePath ? (
    <Module path={unlistedModulePath} showModuleGalleryChild={null} />
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
      autoSave={autoPublish}
      onAutoSaveChange={setAutoPublish}
      pendingChanges={data.pendingChanges ?? 0}
      /*
       * Zeroed when the pending patches cancel out, so Review does not put a
       * number on changes that will not ship. The button itself stays: that
       * view is where Discard is, and Publish is disabled until it is used.
       */
      reviewCount={hasNetChanges ? (data.pendingChanges ?? 0) : 0}
      /*
       * Offered only once the metadata behind the confirm has arrived.
       *
       * The confirm names the other people whose work would go, and those
       * names come from the patch sets. While those are still grouping the
       * list is empty — so an eager button could throw away a colleague's
       * work having promised, and shown, nothing about it. A row that appears
       * a moment late is the cheaper mistake.
       */
      onDiscardAll={
        discardablePatchIds.length > 0 && patchSets.status === "success"
          ? () => deletePatches(discardablePatchIds)
          : undefined
      }
      discardAllDescription={discardAllDescription(
        discardablePatchIds.length,
        discardAuthorNames,
      )}
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
      initialCanvasOpen={urlState.initial.canvasOpen}
      initialCanvasView={urlState.initial.canvasView}
      restoreViewState={restoreViewState}
      initialCanvasTransform={urlState.initial.canvasTransform}
      onViewStateChange={setViewState}
      onNewPage={addPage}
      onDuplicatePage={duplicatePage}
      onUploadMedia={uploadInto}
      onPreview={openPreviewTab}
      // Also as an href, so the menu item is a link that can be copied. The URL
      // enables preview and redirects, so it is worth sending to someone.
      previewHref={previewHref}
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
      onMentionField={(sourcePath) => insertFieldRef(sourcePath as SourcePath)}
      // Held until the first load's patches are in — see `PendingChangesGate`.
      pendingChangesLoaded={pendingChangesLoaded}
      pendingChangesProgress={pendingChangesProgress}
      pendingChangesError={pendingChangesError}
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
      canDiscard
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
