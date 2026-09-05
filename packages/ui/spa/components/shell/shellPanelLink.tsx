import {
  createContext,
  MouseEvent,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { ShellPanel } from "./types";
import { applyShellUrlState, parseShellUrlState } from "./useShellUrlState";

/**
 * A link to one of the shell's panels, from anywhere inside the shell.
 *
 * Two halves, because a panel is reachable two ways and they have to agree:
 *
 * - **From outside**: `?panel=settings` on any Studio URL. That is read once, on
 *   mount (see `useShellUrlState`), which is exactly what a shared link needs
 *   and is no use at all to a click inside the app.
 * - **From inside**: this context. The shell owns which panel is open, and a
 *   row in the publish diff is many components below it, so the request travels
 *   through here rather than through the address bar.
 *
 * The href is real either way, so a settings link can be middle-clicked into a
 * new tab like any other — the whole reason these are anchors and not buttons
 * (see `useNavLink`, which does the same for the studio's own router).
 */
type ShellPanelContextValue = {
  openPanel: (panel: ShellPanel) => void;
};

const ShellPanelContext = createContext<ShellPanelContextValue | null>(null);

export function ShellPanelProvider({
  openPanel,
  children,
}: {
  openPanel: (panel: ShellPanel) => void;
  children: ReactNode;
}) {
  const value = useMemo<ShellPanelContextValue>(
    () => ({ openPanel }),
    [openPanel],
  );
  return (
    <ShellPanelContext.Provider value={value}>
      {children}
    </ShellPanelContext.Provider>
  );
}

/**
 * The URL that opens a panel, keeping everything else in the query.
 *
 * `?panel=` is the shell's own parameter, so this goes through the same
 * parse/apply pair the shell uses rather than concatenating a query string —
 * a hand-built one drops the canvas the reader had open.
 */
export function shellPanelHref(panel: ShellPanel): string {
  if (typeof window === "undefined") {
    return `?panel=${panel}`;
  }
  const search = applyShellUrlState(window.location.search, {
    ...parseShellUrlState(window.location.search),
    panel,
  });
  return `${window.location.pathname}${search}`;
}

/**
 * What to spread onto an `<a>` so it opens a panel.
 *
 * Outside a shell — Storybook, a unit test — the click falls through to the
 * href, which is a real URL that opens the panel on load. So a component using
 * this stays usable in a story instead of throwing for want of a provider.
 */
export function useShellPanelLink(panel: ShellPanel): {
  href: string;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
} {
  const context = useContext(ShellPanelContext);
  const openPanel = context?.openPanel;
  const onClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        openPanel === undefined ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      openPanel(panel);
    },
    [openPanel, panel],
  );
  return { href: shellPanelHref(panel), onClick };
}
