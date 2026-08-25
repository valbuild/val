import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AIChatPanel } from "./AIChatPanel";
import { DataPanel } from "./DataPanel";
import { EditorCanvas, EmptyEditorState, PageEditor } from "./EditorCanvas";
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
import { StatusBar, SaveState } from "./StatusBar";
import { PublishState, TopBar } from "./TopBar";
import { UtilityPanel } from "./UtilityPanel";
import { useShellBreakpoint } from "./useShellBreakpoint";
import {
  ShellChatMessage,
  ShellData,
  ShellNotification,
  ShellPanel,
} from "./types";

/** What the editor canvas is currently showing. */
type Selection = {
  kind: "page" | "external" | "media" | "data";
  id: string;
  title: string;
  urlPath: string;
  sourcePath: string;
  hasDraft?: boolean;
};

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
  saveState = "saved",
  pendingChanges = 12,
  publishState = "idle",
  isLoading = false,
  loadError,
  initialDeploymentsOpen = false,
}: ShellProps) {
  const breakpoint = useShellBreakpoint();
  const [openPanel, setOpenPanel] = useState<ShellPanel | null>(initialPanel);
  const [autoSave, setAutoSave] = useState(true);
  const [isDevMode, setIsDevMode] = useState(true);
  const [notifications, setNotifications] = useState<ShellNotification[]>(
    data.notifications ?? [],
  );
  const [chat, setChat] = useState<ShellChatMessage[]>(data.chat ?? []);
  const [selection, setSelection] = useState<Selection | null>(() =>
    initialSelectionId ? findSelection(data, initialSelectionId) : null,
  );
  const [isSearchOpen, setIsSearchOpen] = useState(initialSearchOpen);
  const [deploymentsOpen, setDeploymentsOpen] = useState(
    initialDeploymentsOpen,
  );
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
    }
  }, [data.deployments]);
  const openSearch = useCallback(() => setIsSearchOpen(true), []);
  useGlobalSearchShortcut(openSearch);
  const searchResults = useMemo(() => collectSearchResults(data), [data]);

  const validationErrorCount = useMemo(
    () => data.validationErrors.reduce((sum, e) => sum + e.count, 0),
    [data.validationErrors],
  );
  const unreadNotifications = useMemo(
    () => notifications.filter((n) => n.unread).length,
    [notifications],
  );

  const closePanel = useCallback(() => setOpenPanel(null), []);
  const togglePanel = useCallback((panel: ShellPanel) => {
    setOpenPanel((current) => (current === panel ? null : panel));
  }, []);
  // On mobile a panel covers the editor, so selecting something has to get
  // the panel out of the way of the thing that was just selected.
  const select = useCallback(
    (next: Selection) => {
      setSelection(next);
      if (breakpoint === "mobile") setOpenPanel(null);
    },
    [breakpoint],
  );

  // A search result can be any kind of item, so it resolves through the same
  // lookup the initial selection uses rather than duplicating the mapping.
  const selectSearchResult = useCallback(
    (result: SearchResult) => {
      const next = findSelection(data, result.id);
      if (next) select(next);
    },
    [data, select],
  );

  const navSwitcher =
    breakpoint === "mobile" ? (
      <MobileNavSwitcher openPanel={openPanel} onSelect={setOpenPanel} />
    ) : undefined;

  return (
    <div
      data-mode={theme}
      className="relative w-full overflow-hidden bg-bg-canvas text-fg-primary font-sans"
      style={{ height: "100svh" }}
    >
      <EditorCanvas>
        {selection === null ? (
          <EmptyEditorState />
        ) : (
          <PageEditor
            title={selection.title}
            urlPath={selection.urlPath}
            sourcePath={selection.sourcePath}
            isDevMode={isDevMode}
            hasDraft={selection.hasDraft}
          />
        )}
      </EditorCanvas>

      {breakpoint === "desktop" && (
        <LeftRail
          openPanel={openPanel}
          onSelect={togglePanel}
          user={data.user}
          hasDraftChanges={pendingChanges > 0}
        />
      )}

      <TopBar
        breakpoint={breakpoint}
        projectName={data.projectName}
        openPanel={openPanel}
        onTogglePanel={togglePanel}
        onOpenMenu={() => setOpenPanel("pages")}
        onOpenSearch={openSearch}
        unreadNotifications={
          data.notifications === undefined ? undefined : unreadNotifications
        }
        // The rail owns the account wherever it is shown. Passing the user
        // here too would put the same avatar in two corners of one screen.
        user={breakpoint === "desktop" ? undefined : data.user}
        onPreview={() => undefined}
        onPublish={() => undefined}
        pendingChanges={pendingChanges}
        publishState={
          publishState === "idle" && validationErrorCount > 0
            ? "blocked"
            : publishState
        }
        validationErrorCount={validationErrorCount}
        onShowErrors={() => setOpenPanel("utility")}
      />

      {breakpoint === "mobile" ? (
        <MobileBottomBar
          pendingChanges={pendingChanges}
          onPreview={() => undefined}
          onPublish={() => undefined}
          onOpenStatus={() => setOpenPanel("settings")}
        />
      ) : (
        <StatusBar
          breakpoint={breakpoint}
          saveState={saveState}
          isDevMode={isDevMode}
          autoSave={autoSave}
          onAutoSaveChange={setAutoSave}
          branch={data.branch}
          deployments={deployments}
          deploymentsOpen={deploymentsOpen}
          onDeploymentsOpenChange={setDeploymentsOpen}
          onDismissDeployment={dismissDeployment}
        />
      )}

      {openPanel === "pages" && (
        <PagesPanel
          breakpoint={breakpoint}
          pages={data.pages}
          externalPages={data.externalPages}
          selectedId={selection?.id ?? null}
          onSelectPage={(page) =>
            select({
              kind: "page",
              id: page.id,
              title: page.name,
              urlPath: page.urlPath,
              sourcePath: `/content/pages.val.ts?p="${page.urlPath}"`,
              hasDraft: page.hasDraft,
            })
          }
          onSelectExternalPage={(page) =>
            select({
              kind: "external",
              id: page.id,
              title: page.name,
              urlPath: page.url,
              sourcePath: `/content/external.val.ts?p="${page.url}"`,
            })
          }
          onNewPage={() => undefined}
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
          onSelect={(gallery) =>
            select({
              kind: "media",
              id: gallery.id,
              title: gallery.name,
              urlPath: gallery.directory,
              sourcePath: `/content/media.val.ts`,
            })
          }
          onUpload={() => undefined}
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
          onSelect={(module) =>
            select({
              kind: "data",
              id: module.id,
              title: module.name,
              urlPath: module.moduleFilePath,
              sourcePath: module.moduleFilePath,
              hasDraft: module.hasDraft,
            })
          }
          onNewDataFile={() => undefined}
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
          theme={theme}
          onThemeChange={onThemeChange}
          isDevMode={isDevMode}
          onDevModeChange={setIsDevMode}
          autoSave={autoSave}
          onAutoSaveChange={setAutoSave}
          branch={data.branch}
          deployments={deployments}
          onDismissDeployment={dismissDeployment}
          onSignOut={() => undefined}
          onClose={closePanel}
          navSwitcher={navSwitcher}
        />
      )}

      {openPanel === "utility" && (
        <UtilityPanel
          breakpoint={breakpoint}
          activity={data.activity}
          validationErrors={data.validationErrors}
          onSelectValidationError={() => undefined}
          onNewPage={() => undefined}
          onUploadMedia={() => undefined}
          onNewDataFile={() => undefined}
          onOpenAI={() => setOpenPanel("ai")}
          onSelectActivity={() => undefined}
          onClose={closePanel}
        />
      )}

      {openPanel === "ai" && (
        <AIChatPanel
          breakpoint={breakpoint}
          messages={chat}
          suggestions={data.chatSuggestions}
          context={selection ? selection.title : "this project"}
          onSend={(text) =>
            setChat((current) => [
              ...current,
              { id: `local-${current.length}`, role: "user", text },
            ])
          }
          onProposalAction={() => undefined}
          onNewSession={() => setChat([])}
          onClose={closePanel}
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

/** Resolve an initial selection id against every kind of navigable item. */
function findSelection(data: ShellData, id: string): Selection | null {
  const fromPages = (pages: ShellData["pages"]): Selection | null => {
    for (const page of pages) {
      if (page.id === id) {
        return {
          kind: "page",
          id: page.id,
          title: page.name,
          urlPath: page.urlPath,
          sourcePath: `/content/pages.val.ts?p="${page.urlPath}"`,
          hasDraft: page.hasDraft,
        };
      }
      const child = fromPages(page.children ?? []);
      if (child) return child;
    }
    return null;
  };
  const page = fromPages(data.pages);
  if (page) return page;
  const external = data.externalPages.find((entry) => entry.id === id);
  if (external) {
    return {
      kind: "external",
      id: external.id,
      title: external.name,
      urlPath: external.url,
      sourcePath: `/content/external.val.ts?p="${external.url}"`,
    };
  }
  const gallery = data.media.find((entry) => entry.id === id);
  if (gallery) {
    return {
      kind: "media",
      id: gallery.id,
      title: gallery.name,
      urlPath: gallery.directory,
      sourcePath: "/content/media.val.ts",
    };
  }
  const module = data.data.find((entry) => entry.id === id);
  if (module) {
    return {
      kind: "data",
      id: module.id,
      title: module.name,
      urlPath: module.moduleFilePath,
      sourcePath: module.moduleFilePath,
      hasDraft: module.hasDraft,
    };
  }
  return null;
}
