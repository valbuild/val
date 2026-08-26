import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ModuleFilePath } from "@valbuild/core";
import { AIChatPanel } from "./AIChatPanel";
import { DataPanel } from "./DataPanel";
import { EmptyEditorState, PageEditor } from "./EditorCanvas";
import {
  CanvasView,
  PageWorkspace,
  PageWorkspaceProps,
} from "./canvas/PageWorkspace";
import { CanvasPageData, CanvasTransform } from "./canvas/types";
import {
  GlobalSearch,
  SearchResult,
  collectSearchResults,
  useGlobalSearchShortcut,
} from "./GlobalSearch";
import { LeftRail } from "./LeftRail";
import { MediaPanel } from "./MediaPanel";
import { MobileBottomBar, MobileNavSwitcher } from "./MobileChrome";
import { NotificationsPanel } from "./NotificationsPanel";
import { PagesPanel } from "./PagesPanel";
import { SettingsPanel } from "./SettingsPanel";
import { ShellAccountError } from "./AccountError";
import { StatusBar, SaveState, StatusBarProps } from "./StatusBar";
import { PublishState, TopBar } from "./TopBar";
import { UtilityPanel } from "./UtilityPanel";
import { availableDestinations } from "./shellDataMapping";
import { servedPath } from "../../utils/mediaPath";
import { useShellBreakpoint } from "./useShellBreakpoint";
import {
  ShellActivityEntry,
  ShellChatMessage,
  ShellData,
  ShellDataModule,
  ShellExternalPage,
  ShellMediaGallery,
  ShellNotification,
  ShellPanel,
  ShellValidationError,
} from "./types";

/** What the editor canvas is currently showing. */
export type ShellSelection = {
  kind: "page" | "external" | "media" | "data";
  id: string;
  title: string;
  /** What to show above the editor: a URL for a page, a directory for media. */
  urlPath: string;
  /**
   * The content this selection opens.
   *
   * Comes from the navigation data rather than being derived from the id: only
   * the provider knows which module a route resolves to, and guessing it is
   * how a shell ends up opening a module that does not exist.
   */
  sourcePath: string;
  hasDraft?: boolean;
  /** True when Val resolves this route and can therefore put it on a canvas. */
  isTracked?: boolean;
};

/** How many recent changes the search offers. See `recentSearchResults`. */
const RECENT_SEARCH_LIMIT = 5;

export type ShellProps = {
  data: ShellData;
  /** Panel to open on mount. */
  initialPanel?: ShellPanel | null;
  /** Item to select on mount, by id. Unknown ids show the empty state. */
  initialSelectionId?: string | null;
  /** Open the global search on mount. */
  initialSearchOpen?: boolean;
  theme: "dark" | "light";
  onThemeChange: (theme: "dark" | "light") => void;
  /** How Val is running. See `StatusBarProps`. */
  mode?: StatusBarProps["mode"];
  saveState?: SaveState;
  /** Number of changes Publish would ship. */
  pendingChanges?: number;
  publishState?: PublishState;
  /** Show placeholder rows in the nav panels instead of content. */
  isLoading?: boolean;
  /** Show a load failure in the nav panels instead of content. */
  loadError?: string;
  /** Open the deployments list on mount, as a publish would. */
  initialDeploymentsOpen?: boolean;
  /**
   * The page to put on the canvas.
   *
   * One page rather than a lookup, because the canvas is fed by the running
   * site reporting what is on the route it is currently showing — not by
   * something the shell can know up front.
   */
  canvasPage?: CanvasPageData;
  /**
   * What to put on the canvas, at the size the device switch asks for.
   *
   * The app passes the running site; Storybook passes nothing and the demo
   * page is built from `canvasPage` instead. Either is enough to offer the
   * canvas — the fields view needs `canvasPage` specifically, because it is a
   * list of what Val found on the page.
   */
  renderCanvas?: PageWorkspaceProps["renderCanvas"];
  /** What the running page reported finding on itself. See `PageWorkspace`. */
  canvasPaths?: PageWorkspaceProps["canvasPaths"];
  onSelectCanvasPath?: PageWorkspaceProps["onSelectCanvasPath"];
  selectedCanvasPath?: PageWorkspaceProps["selectedCanvasPath"];
  /** The canvas's address bar. See `PageWorkspaceProps`. */
  canvasRoute?: PageWorkspaceProps["canvasRoute"];
  onCanvasRouteChange?: PageWorkspaceProps["onCanvasRouteChange"];
  canvasRoutes?: PageWorkspaceProps["canvasRoutes"];
  /** Where a link left the canvas looking. See `PageWorkspaceProps`. */
  initialCanvasTransform?: PageWorkspaceProps["initialTransform"];
  /**
   * Reported whenever the view state changes, so it can be put in the URL.
   *
   * One callback for all of it rather than one per thing, because they are one
   * answer to one question — where am I looking — and a link that carries half
   * of it restores the wrong view.
   */
  onViewStateChange?: (state: {
    panel: ShellPanel | null;
    canvasOpen: boolean;
    canvasView: CanvasView;
    canvasTransform: CanvasTransform | null;
  }) => void;
  /** Open the canvas on mount. */
  initialCanvasOpen?: boolean;
  initialCanvasView?: CanvasView;
  /** Skips the canvas entrance transition — for screenshots and for tests. */
  skipTransition?: boolean;
  /**
   * The selected item, by id, when something outside the shell owns the
   * selection — in the app that is the router, which has to stay the single
   * source of truth so a reload lands where you were. Leave it undefined and
   * the shell keeps the selection itself, which is what Storybook does.
   */
  selectionId?: string | null;
  /** Called whenever something is picked, in either mode. */
  onSelectionChange?: (selection: ShellSelection) => void;
  /**
   * The editor for the selected item. Defaults to a representative stand-in so
   * the layout can be exercised without the Val providers; the app passes the
   * real field editor.
   */
  renderEditor?: (selection: ShellSelection) => ReactNode;
  /**
   * Something to show in the editor column instead of the selection's editor.
   *
   * The compare and errors views are not items: they take the whole column and
   * have no row in the navigation to be selected. They are still *in* the
   * column rather than replacing the shell, so the chrome around them keeps
   * working — you can publish from the compare view, which is the point of it.
   */
  editorOverride?: ReactNode;
  onPublish?: () => void;
  /**
   * The real publish control, when there is one. See `TopBarProps` — the app
   * passes the existing control so the publish rules live in one place.
   */
  publishSlot?: ReactNode;
  onPreview?: () => void;
  onSignOut?: () => void;
  /** Open the full validation-errors view. Falls back to the utility panel. */
  onShowErrors?: () => void;
  /**
   * Why the account could not be loaded, once the studio has stopped trying.
   *
   * Not part of `data`: `data` is the project's content, and this is the state
   * of one request the app made. It marks the account button and explains
   * itself inside the panel that button opens.
   */
  accountError?: ShellAccountError;
  /**
   * Why the assistant is unavailable, once the studio has stopped trying.
   *
   * Shown in the AI panel in place of the composer. Absent means it is either
   * working or still connecting, and the panel offers a composer as usual.
   */
  aiUnavailable?: { message: string; onRetry: () => void };
  /**
   * Whether this project has an assistant at all.
   *
   * Absent means it does not, and every way into one is hidden: the top bar
   * button, the quick action, the canvas field menu's Attach to chat, and the
   * panel itself — including when a restored URL asks for it. Same rule the
   * rail follows for a destination with no content behind it: an affordance
   * that can only report that there is nothing there is worse than no
   * affordance.
   */
  aiEnabled?: boolean;
  onSelectValidationError?: (error: ShellValidationError) => void;
  onSelectActivity?: (entry: ShellActivityEntry) => void;
  /** Create a page under a route. See `PagesPanelProps`. */
  onNewPage?: (moduleFilePath: ModuleFilePath, urlPath: string) => void;
  onUploadMedia?: (gallery: ShellMediaGallery) => void;
  /** Open the review view. Offered from the quick actions. */
  onCompare?: () => void;
  /** A thumbnail URL for a media file. See `MediaPanelProps`. */
  getMediaFileUrl?: (ref: string) => string | null;
  /** Content matches for the current query. See `GlobalSearchProps`. */
  searchContentResults?: SearchResult[];
  isSearchingContent?: boolean;
  onSearchQueryChange?: (query: string) => void;
  /**
   * Open a search result the shell cannot resolve to a row.
   *
   * A content hit points at a field inside a module, which is deeper than any
   * navigation row, so only the app can open it.
   */
  onOpenSearchResult?: (result: SearchResult) => void;
};

/**
 * The Val shell: a floating layout around a fixed-width editor.
 *
 * The rail, bars and panels all float above the canvas, so the thing being
 * edited keeps its position and width no matter what chrome is open. State
 * lives here rather than in the individual pieces, which stay
 * presentational.
 */
export function Shell({
  data,
  initialPanel = null,
  initialSelectionId = null,
  initialSearchOpen = false,
  theme,
  onThemeChange,
  mode,
  saveState = "saved",
  pendingChanges = 12,
  publishState = "idle",
  isLoading = false,
  loadError,
  initialDeploymentsOpen = false,
  canvasPage,
  renderCanvas,
  canvasPaths,
  onSelectCanvasPath,
  selectedCanvasPath,
  canvasRoute,
  onCanvasRouteChange,
  canvasRoutes,
  initialCanvasTransform,
  onViewStateChange,
  initialCanvasOpen = false,
  initialCanvasView = "normal",
  skipTransition,
  selectionId,
  onSelectionChange,
  renderEditor,
  editorOverride,
  onPublish,
  publishSlot,
  onPreview,
  onSignOut,
  onShowErrors,
  accountError,
  aiUnavailable,
  aiEnabled = false,
  onSelectValidationError,
  onSelectActivity,
  onNewPage,
  onUploadMedia,
  onCompare,
  getMediaFileUrl,
  searchContentResults,
  isSearchingContent,
  onSearchQueryChange,
  onOpenSearchResult,
}: ShellProps) {
  const breakpoint = useShellBreakpoint();
  const [openPanel, setOpenPanel] = useState<ShellPanel | null>(initialPanel);
  const [autoSave, setAutoSave] = useState(true);
  const [isDevMode, setIsDevMode] = useState(true);
  const [notifications, setNotifications] = useState<ShellNotification[]>(
    data.notifications ?? [],
  );
  const [chat, setChat] = useState<ShellChatMessage[]>(data.chat ?? []);
  const isControlled = selectionId !== undefined;
  const [internalSelection, setInternalSelection] =
    useState<ShellSelection | null>(() =>
      initialSelectionId ? findShellSelection(data, initialSelectionId) : null,
    );
  // In controlled mode the selection is a function of the id and the data, so
  // it follows both: navigation changes the id, and a reload that fills the
  // navigation in resolves an id that could not be resolved on mount.
  const controlledSelection = useMemo(
    () => (selectionId ? findShellSelection(data, selectionId) : null),
    [selectionId, data],
  );
  const selection = isControlled ? controlledSelection : internalSelection;
  const [isSearchOpen, setIsSearchOpen] = useState(initialSearchOpen);
  const [isCanvasOpen, setIsCanvasOpen] = useState(initialCanvasOpen);
  const [canvasView, setCanvasView] = useState<CanvasView>(initialCanvasView);
  // The canvas's own position, kept here only so it can be reported outward
  // with the rest of the view state — the canvas owns it.
  const [canvasTransform, setCanvasTransform] =
    useState<CanvasTransform | null>(initialCanvasTransform ?? null);
  useEffect(() => {
    onViewStateChange?.({
      panel: openPanel,
      canvasOpen: isCanvasOpen,
      canvasView,
      canvasTransform,
    });
  }, [onViewStateChange, openPanel, isCanvasOpen, canvasView, canvasTransform]);
  const [deploymentsOpen, setDeploymentsOpen] = useState(
    initialDeploymentsOpen,
  );
  // Whether the list on screen is one that opened itself. Only that one closes
  // itself again; a list you opened stays until you close it.
  const [deploymentsAutoOpened, setDeploymentsAutoOpened] = useState(false);
  const setDeploymentsOpenByUser = useCallback((open: boolean) => {
    setDeploymentsOpen(open);
    setDeploymentsAutoOpened(false);
  }, []);
  const [dismissedDeployments, setDismissedDeployments] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const dismissDeployment = useCallback((commitSha: string) => {
    setDismissedDeployments((current) => new Set(current).add(commitSha));
  }, []);
  const deployments = useMemo(
    () =>
      data.deployments?.filter(
        (deployment) => !dismissedDeployments.has(deployment.commitSha),
      ),
    [data.deployments, dismissedDeployments],
  );

  // A publish is the one thing here that finishes somewhere else, so the list
  // opens itself when a commit Val has not seen before shows up. The first
  // feed after mount is history rather than news: opening on it would pop a
  // panel at someone who has not published anything.
  const seenCommits = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (data.deployments === undefined) {
      return;
    }
    const commits = new Set(data.deployments.map((d) => d.commitSha));
    const seen = seenCommits.current;
    seenCommits.current = commits;
    if (seen === null) {
      return;
    }
    if (data.deployments.some((d) => !seen.has(d.commitSha))) {
      setDeploymentsOpen(true);
      setDeploymentsAutoOpened(true);
    }
  }, [data.deployments]);
  const openSearch = useCallback(() => setIsSearchOpen(true), []);
  useGlobalSearchShortcut(openSearch);
  const searchResults = useMemo(() => collectSearchResults(data), [data]);
  /**
   * The last few things that changed, as search rows.
   *
   * From the activity feed, which is the patch sets — already newest first and
   * already grouped by the thing that changed. Five, because this is a "take me
   * back" list rather than a history: past that it stops being a shortcut and
   * starts being something to read.
   */
  const recentSearchResults = useMemo(
    (): SearchResult[] =>
      (data.activity ?? []).slice(0, RECENT_SEARCH_LIMIT).map((entry) => ({
        id: entry.sourcePath,
        kind: "recent",
        label: entry.title,
        detail: entry.author
          ? `${entry.timestamp} · ${entry.author}`
          : entry.timestamp,
      })),
    [data.activity],
  );

  /** See `availableDestinations`. */
  const destinations = useMemo(
    () => availableDestinations(data, isLoading),
    [isLoading, data],
  );
  // A panel for a destination this project does not have cannot be opened, and
  // a link that asks for one lands on the editor rather than on an empty panel.
  useEffect(() => {
    if (
      openPanel !== null &&
      (openPanel === "pages" ||
        openPanel === "media" ||
        openPanel === "data") &&
      !destinations.includes(openPanel)
    ) {
      setOpenPanel(null);
    }
  }, [openPanel, destinations]);
  // Same rule for the assistant, which is not a destination but is just as
  // absent: a `?panel=ai` link into a project without one would otherwise
  // restore an empty panel that nothing can fill.
  useEffect(() => {
    if (openPanel === "ai" && !aiEnabled) {
      setOpenPanel(null);
    }
  }, [openPanel, aiEnabled]);

  const validationErrorCount = useMemo(
    () => data.validationErrors.reduce((sum, e) => sum + e.count, 0),
    [data.validationErrors],
  );
  const unreadNotifications = useMemo(
    () => notifications.filter((n) => n.unread).length,
    [notifications],
  );

  /**
   * Whether the canvas is on offer.
   *
   * Wherever there is something to put on it, and nothing about the selection.
   * The canvas is a browser pointed at a URL: it does not need a page selected
   * any more than a browser needs one, and with the route bar it can be pointed
   * anywhere. Gating it on the selection meant a project of pure content files
   * could never see its own site, and that editing a settings module — which is
   * exactly when you want to watch a page react — closed the canvas.
   *
   * What a page selection adds is a starting URL and the content on it; both of
   * those degrade on their own, to `/` and to an empty fields view.
   */
  const canCanvas = renderCanvas !== undefined || canvasPage !== undefined;
  const toggleCanvas = useCallback(() => setIsCanvasOpen((open) => !open), []);
  // Closing puts the module editor back, so the way out lands where the way
  // in started rather than on whichever view you happened to end on.
  const closeCanvas = useCallback(() => {
    setIsCanvasOpen(false);
    setCanvasView("normal");
  }, []);
  // Picking a field on the canvas points the assistant at it. It is the same
  // act as selecting one in the panel, so it opens the assistant rather than
  // silently arming it.
  const [chatTarget, setChatTarget] = useState<string | null>(null);
  const attachToChat = useCallback((_fieldId: string, label: string) => {
    setChatTarget(label);
    setOpenPanel("ai");
  }, []);

  /**
   * Anything that is not a page leaves the canvas.
   *
   * The canvas is still offered everywhere — the Preview button does not come
   * and go with the selection — but landing on something that is not on a route
   * means the canvas is showing a page you are no longer editing. In the fields
   * view it is worse than stale: the editor column IS the page's fields, so the
   * module you navigated to does not appear at all and the navigation looks like
   * it did nothing.
   *
   * Here rather than in `select` below, because a selection is not the only way
   * to move: a breadcrumb, a deep link and a validation error all change the
   * route without going through the navigation panels, and the router module
   * root — which no row stands for — was reachable from the header.
   *
   * Not while the navigation is still loading, where nothing resolves to a row
   * yet and a link that asked for the canvas would have it shut immediately.
   */
  useEffect(() => {
    if (isLoading) return;
    if (selection?.kind === "page") return;
    setIsCanvasOpen(false);
    setCanvasView("normal");
  }, [isLoading, selection?.kind]);

  const closePanel = useCallback(() => setOpenPanel(null), []);
  const togglePanel = useCallback((panel: ShellPanel) => {
    setOpenPanel((current) => (current === panel ? null : panel));
  }, []);
  // On mobile a panel covers the editor, so selecting something has to get
  // the panel out of the way of the thing that was just selected.
  const select = useCallback(
    (next: ShellSelection) => {
      // In controlled mode the owner of the selection decides what happens;
      // keeping a copy here would let the two disagree.
      if (!isControlled) {
        setInternalSelection(next);
      }
      onSelectionChange?.(next);
      setChatTarget(null);
      if (breakpoint === "mobile") setOpenPanel(null);
    },
    [breakpoint, isControlled, onSelectionChange],
  );

  // A search result can be any kind of item, so it resolves through the same
  // lookup the initial selection uses rather than duplicating the mapping.
  const selectSearchResult = useCallback(
    (result: SearchResult) => {
      const next = findShellSelection(data, result.id);
      if (next) {
        select(next);
        return;
      }
      // A content hit is a path inside a module, which no row can stand for.
      onOpenSearchResult?.(result);
    },
    [data, select, onOpenSearchResult],
  );

  const navSwitcher =
    breakpoint === "mobile" ? (
      <MobileNavSwitcher
        openPanel={openPanel}
        onSelect={setOpenPanel}
        destinations={destinations}
      />
    ) : undefined;

  return (
    <div
      data-mode={theme}
      className="relative w-full overflow-hidden bg-bg-canvas text-fg-primary font-sans"
      style={{ height: "100svh" }}
    >
      <PageWorkspace
        breakpoint={breakpoint}
        page={canCanvas ? canvasPage : undefined}
        renderCanvas={canCanvas ? renderCanvas : undefined}
        canvasPaths={canCanvas ? canvasPaths : undefined}
        onSelectCanvasPath={onSelectCanvasPath}
        selectedCanvasPath={selectedCanvasPath}
        canvasRoute={canCanvas ? canvasRoute : undefined}
        onCanvasRouteChange={onCanvasRouteChange}
        canvasRoutes={canvasRoutes}
        initialTransform={initialCanvasTransform}
        onTransformChange={setCanvasTransform}
        isCanvasOpen={isCanvasOpen && canCanvas}
        onCloseCanvas={closeCanvas}
        view={canvasView}
        onViewChange={setCanvasView}
        isDevMode={isDevMode}
        onAttachToChat={aiEnabled ? attachToChat : undefined}
        skipTransition={skipTransition}
      >
        {editorOverride ? (
          editorOverride
        ) : selection === null ? (
          <EmptyEditorState />
        ) : renderEditor ? (
          renderEditor(selection)
        ) : (
          <PageEditor
            title={selection.title}
            urlPath={selection.urlPath}
            sourcePath={selection.sourcePath}
            isDevMode={isDevMode}
            hasDraft={selection.hasDraft}
          />
        )}
      </PageWorkspace>

      {breakpoint === "desktop" && (
        <LeftRail
          openPanel={openPanel}
          onSelect={togglePanel}
          destinations={destinations}
          user={data.user}
          hasDraftChanges={pendingChanges > 0}
          accountError={accountError}
          isLoading={isLoading}
        />
      )}

      <TopBar
        breakpoint={breakpoint}
        projectName={data.projectName}
        openPanel={openPanel}
        onTogglePanel={togglePanel}
        // The menu button opens the first destination this project has, which
        // is Pages wherever there is one — but a project with no routes has to
        // land somewhere that exists.
        onOpenMenu={() => setOpenPanel(destinations[0] ?? "settings")}
        onOpenSearch={openSearch}
        unreadNotifications={
          data.notifications === undefined ? undefined : unreadNotifications
        }
        // The rail owns the account wherever it is shown. Passing the user
        // here too would put the same avatar in two corners of one screen.
        user={breakpoint === "desktop" ? undefined : data.user}
        // The rail carries the mark on desktop; below that the top bar owns the
        // account, so it owns the mark — and has to put a button there at all,
        // since a failed load means there is no avatar to hang it on.
        accountError={breakpoint === "desktop" ? undefined : accountError}
        isLoading={isLoading}
        aiEnabled={aiEnabled}
        onPreview={onPreview ?? (() => undefined)}
        onToggleCanvas={canCanvas ? toggleCanvas : undefined}
        isCanvasOpen={isCanvasOpen}
        onPublish={onPublish ?? (() => undefined)}
        publishSlot={publishSlot}
        pendingChanges={pendingChanges}
        publishState={
          publishState === "idle" && validationErrorCount > 0
            ? "blocked"
            : publishState
        }
        validationErrorCount={validationErrorCount}
        onShowErrors={onShowErrors ?? (() => setOpenPanel("utility"))}
      />

      {breakpoint === "mobile" ? (
        <MobileBottomBar
          pendingChanges={pendingChanges}
          onPreview={onPreview ?? (() => undefined)}
          onToggleCanvas={canCanvas ? toggleCanvas : undefined}
          isCanvasOpen={isCanvasOpen}
          onPublish={onPublish ?? (() => undefined)}
          publishSlot={publishSlot}
          onOpenStatus={() => setOpenPanel("settings")}
          onOpenQuickActions={() => setOpenPanel("utility")}
        />
      ) : (
        <StatusBar
          breakpoint={breakpoint}
          saveState={saveState}
          mode={mode}
          autoSave={autoSave}
          onAutoSaveChange={setAutoSave}
          branch={data.branch}
          deployments={deployments}
          deploymentsOpen={deploymentsOpen}
          onDeploymentsOpenChange={setDeploymentsOpenByUser}
          deploymentsAutoOpened={deploymentsAutoOpened}
          onDismissDeployment={dismissDeployment}
        />
      )}

      {openPanel === "pages" && (
        <PagesPanel
          breakpoint={breakpoint}
          pages={data.pages}
          externalPages={data.externalPages}
          selectedId={selection?.id ?? null}
          // A row with no source path is a path segment rather than a page —
          // `/blog` existing because `/blog/why-val` does. Clicking it expands
          // it; there is nothing to open.
          onSelectPage={(page) => {
            const next = toPageSelection(page);
            if (next) select(next);
          }}
          onSelectExternalPage={(page) => {
            const next = toExternalSelection(page);
            if (next) select(next);
          }}
          onNewPage={onNewPage ?? (() => undefined)}
          // Only where a route accepts one. A project of static routes has no
          // key to invent, so there is nothing for a New page button to do.
          newPage={onNewPage ? data.newPage : undefined}
          onClose={closePanel}
          navSwitcher={navSwitcher}
          isLoading={isLoading}
          loadError={loadError}
        />
      )}

      {openPanel === "media" && (
        <MediaPanel
          breakpoint={breakpoint}
          media={data.media}
          selectedId={selection?.id ?? null}
          onSelect={(gallery) => select(toMediaSelection(gallery))}
          onSelectFile={(gallery, file) =>
            select({
              kind: "media",
              // The file's own entry, so the editor opens that one rather than
              // the whole gallery.
              id: file.sourcePath,
              title: file.ref.split("/").pop() ?? file.ref,
              urlPath: servedPath(gallery.directory),
              sourcePath: file.sourcePath,
            })
          }
          getFileUrl={getMediaFileUrl}
          // The panel asks which gallery; it used to guess from the selection,
          // so the button did nothing at all unless a gallery happened to be
          // open — which is most of the time.
          onUpload={onUploadMedia}
          onClose={closePanel}
          navSwitcher={navSwitcher}
          isLoading={isLoading}
          loadError={loadError}
        />
      )}

      {openPanel === "data" && (
        <DataPanel
          breakpoint={breakpoint}
          data={data.data}
          selectedId={selection?.id ?? null}
          onSelect={(module) => select(toDataSelection(module))}
          onClose={closePanel}
          navSwitcher={navSwitcher}
          isLoading={isLoading}
          loadError={loadError}
        />
      )}

      {openPanel === "settings" && (
        <SettingsPanel
          breakpoint={breakpoint}
          user={data.user}
          accountError={accountError}
          theme={theme}
          onThemeChange={onThemeChange}
          isDevMode={isDevMode}
          onDevModeChange={setIsDevMode}
          autoSave={autoSave}
          onAutoSaveChange={setAutoSave}
          branch={data.branch}
          /**
           * No deploy feed in dev.
           *
           * Running against the working copy on disk there is nothing to
           * publish to, so the section could only ever say "nothing published
           * yet" — a heading and an explanation for something that will never
           * happen here. The status bar already applies this rule to its own
           * feed (`mode === "http"`); the panel was missed.
           */
          deployments={mode === "fs" ? undefined : deployments}
          onDismissDeployment={dismissDeployment}
          // Passed through as-is: absent means there is no session to end, and
          // the panel then shows no Sign out button rather than a dead one.
          onSignOut={onSignOut}
          onClose={closePanel}
          navSwitcher={navSwitcher}
        />
      )}

      {openPanel === "utility" && (
        <UtilityPanel
          breakpoint={breakpoint}
          activity={data.activity}
          validationErrors={data.validationErrors}
          onSelectValidationError={onSelectValidationError ?? (() => undefined)}
          // Both quick actions are shortcuts to the panel that owns the flow:
          // the route picker and the gallery picker live there, and a second
          // copy of either would be a second set of rules for what a URL or a
          // directory may be.
          onNewPage={() => setOpenPanel("pages")}
          onUploadMedia={() => setOpenPanel("media")}
          destinations={destinations}
          onOpenAI={aiEnabled ? () => setOpenPanel("ai") : undefined}
          onCompare={onCompare}
          pendingChanges={pendingChanges}
          onSelectActivity={onSelectActivity ?? (() => undefined)}
          onClose={closePanel}
        />
      )}

      {openPanel === "ai" && aiEnabled && (
        <AIChatPanel
          breakpoint={breakpoint}
          messages={chat}
          suggestions={data.chatSuggestions}
          context={chatTarget ?? (selection ? selection.title : "this project")}
          onSend={(text) =>
            setChat((current) => [
              ...current,
              { id: `local-${current.length}`, role: "user", text },
            ])
          }
          onProposalAction={() => undefined}
          onNewSession={() => setChat([])}
          onClose={closePanel}
          unavailable={aiUnavailable}
        />
      )}

      {openPanel === "notifications" && (
        <NotificationsPanel
          breakpoint={breakpoint}
          notifications={notifications}
          onSelect={(notification) =>
            setNotifications((current) =>
              current.map((n) =>
                n.id === notification.id ? { ...n, unread: false } : n,
              ),
            )
          }
          onMarkAllRead={() =>
            setNotifications((current) =>
              current.map((n) => ({ ...n, unread: false })),
            )
          }
          onClose={closePanel}
        />
      )}

      {isSearchOpen && (
        <GlobalSearch
          results={searchResults}
          contentResults={searchContentResults}
          recentResults={recentSearchResults}
          isSearchingContent={isSearchingContent}
          onQueryChange={onSearchQueryChange}
          onSelect={(result) => {
            setIsSearchOpen(false);
            selectSearchResult(result);
          }}
          onClose={() => setIsSearchOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * One page row as a selection, or null when the row cannot be opened.
 *
 * Every selection carries the source path the navigation data gave it. Nothing
 * here derives a path from a URL: which module serves `/blog/why-val` is the
 * router's answer, not a string the shell can build.
 */
function toPageSelection(
  page: ShellData["pages"][number],
): ShellSelection | null {
  if (page.sourcePath === undefined) return null;
  return {
    kind: "page",
    id: page.id,
    title: page.name,
    urlPath: page.urlPath,
    sourcePath: page.sourcePath,
    hasDraft: page.hasDraft,
    isTracked: page.isTracked,
  };
}

function toExternalSelection(page: ShellExternalPage): ShellSelection | null {
  if (page.sourcePath === undefined) return null;
  return {
    kind: "external",
    id: page.id,
    title: page.name,
    urlPath: page.url,
    sourcePath: page.sourcePath,
  };
}

/** A gallery opens the module that holds it, which renders the grid. */
function toMediaSelection(gallery: ShellMediaGallery): ShellSelection {
  return {
    kind: "media",
    id: gallery.id,
    title: gallery.name,
    // Where its files are served from, not where they are stored: `/public` is
    // the web root, so the ref and the URL differ by exactly that prefix.
    urlPath: servedPath(gallery.directory),
    sourcePath: gallery.moduleFilePath,
  };
}

function toDataSelection(module: ShellDataModule): ShellSelection {
  return {
    kind: "data",
    id: module.id,
    title: module.name,
    urlPath: module.moduleFilePath,
    sourcePath: module.moduleFilePath,
    hasDraft: module.hasDraft,
  };
}

/**
 * Resolve a selection id against every kind of navigable item.
 *
 * Exported because the app needs the same answer for more than the editor: the
 * canvas needs the URL of the page it is on, and deriving that a second way is
 * how the two come to disagree about what is selected.
 */
export function findShellSelection(
  data: ShellData,
  id: string,
): ShellSelection | null {
  const fromPages = (pages: ShellData["pages"]): ShellSelection | null => {
    for (const page of pages) {
      if (page.id === id) return toPageSelection(page);
      const child = fromPages(page.children ?? []);
      if (child) return child;
    }
    return null;
  };
  const page = fromPages(data.pages);
  if (page) return page;
  const external = data.externalPages.find((entry) => entry.id === id);
  if (external) return toExternalSelection(external);
  const gallery = data.media.find((entry) => entry.id === id);
  if (gallery) return toMediaSelection(gallery);
  const module = data.data.find((entry) => entry.id === id);
  if (module) return toDataSelection(module);
  return null;
}
