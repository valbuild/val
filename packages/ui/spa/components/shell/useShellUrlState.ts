import { useCallback, useEffect, useMemo, useState } from "react";
import { CanvasView } from "./canvas/PageWorkspace";
import { CanvasTransform } from "./canvas/types";
import { ShellPanel } from "./types";

/**
 * The studio's state that belongs in the URL.
 *
 * Everything here answers "where am I looking", which is the thing a link is
 * for. The route already carries what is being edited; this carries the rest of
 * it — whether the canvas is open, what it is showing, and where in the page it
 * is — so that sending someone a link sends them the view you are on rather
 * than the module you happen to have open.
 *
 * Zoom and pan are in it too. That reads as a detail until you have tried to
 * point at something on a long page: "the third card down, zoom out a bit" is
 * the thing a link is supposed to replace.
 */
export type ShellUrlState = {
  /** Which panel is open, if any. */
  panel: ShellPanel | null;
  /** Whether the canvas is open. */
  canvasOpen: boolean;
  /** The route the canvas is showing, when it is not simply the page's own. */
  canvasRoute: string | null;
  canvasView: CanvasView;
  /** Pan and zoom, when they have been moved from the fitted default. */
  canvasTransform: CanvasTransform | null;
};

const PANELS: ShellPanel[] = [
  "pages",
  "media",
  "data",
  "settings",
  "utility",
  "ai",
  "notifications",
];

const PARAM = {
  panel: "panel",
  canvasOpen: "canvas",
  canvasRoute: "canvas-route",
  canvasView: "canvas-view",
  canvasTransform: "canvas-at",
};

/**
 * Read the state out of a query string.
 *
 * Every field falls back rather than throwing: a URL is something a person can
 * edit, and half a link should still open the studio.
 */
export function parseShellUrlState(search: string): ShellUrlState {
  const params = new URLSearchParams(search);
  const panel = params.get(PARAM.panel);
  const view = params.get(PARAM.canvasView);
  return {
    panel: PANELS.find((candidate) => candidate === panel) ?? null,
    canvasOpen: params.get(PARAM.canvasOpen) === "1",
    canvasRoute: params.get(PARAM.canvasRoute),
    canvasView: view === "fields" ? "fields" : "normal",
    canvasTransform: parseTransform(params.get(PARAM.canvasTransform)),
  };
}

/**
 * Pan and zoom as one param: `scale,x,y`.
 *
 * One rather than three because they are one position — a link with the zoom
 * but not the pan is not a view of anything — and because three params of
 * numbers is most of a query string for something nobody reads.
 */
function parseTransform(raw: string | null): CanvasTransform | null {
  if (raw === null) return null;
  const parts = raw.split(",").map((part) => Number.parseFloat(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  const [scale, x, y] = parts;
  // A zero or negative scale is not a view, it is a division by zero waiting
  // to happen in the canvas's own maths.
  if (scale <= 0) return null;
  return { scale, x, y };
}

function formatTransform(transform: CanvasTransform): string {
  // Two decimals on the scale, whole pixels on the offsets: more than that is
  // noise in a URL someone might read or trim.
  return [
    transform.scale.toFixed(2),
    Math.round(transform.x),
    Math.round(transform.y),
  ].join(",");
}

/** Write the state into a query string, leaving everything else alone. */
export function applyShellUrlState(
  search: string,
  state: ShellUrlState,
): string {
  const params = new URLSearchParams(search);
  const set = (key: string, value: string | null) => {
    // Absent rather than empty: a URL should only carry what is true, so that
    // the default state produces no query at all.
    if (value === null) params.delete(key);
    else params.set(key, value);
  };
  set(PARAM.panel, state.panel);
  set(PARAM.canvasOpen, state.canvasOpen ? "1" : null);
  set(PARAM.canvasRoute, state.canvasRoute);
  set(PARAM.canvasView, state.canvasView === "fields" ? "fields" : null);
  set(
    PARAM.canvasTransform,
    state.canvasTransform === null
      ? null
      : formatTransform(state.canvasTransform),
  );
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * How a write should affect history.
 *
 * `replace` for chrome — a panel, a zoom nudge — because making those places in
 * history turns the back button into an undo for furniture. `push` for opening
 * or closing the canvas, which IS somewhere you were: leaving it and pressing
 * back should put it back, and with a replace there was nothing to go back to.
 */
export type HistoryMode = "push" | "replace";

/**
 * Whether writing this state is a place in history.
 *
 * Only the canvas is. Everything else here is furniture — which panel is open,
 * where the canvas is panned — and a history entry per nudge turns the back
 * button into an undo for chrome rather than a way back to what you were
 * editing. Opening and closing the canvas is different in kind: it is the
 * difference between looking at the page and looking at the fields, and leaving
 * it used to be unreturnable.
 *
 * Compared against what the URL CURRENTLY says, not against the last state this
 * session wrote, and the difference is not academic. Tracking the last write
 * makes the first one of a session unclassifiable — and the first write is
 * exactly the one that closes a canvas a link opened, so it went in as a replace
 * and the back button then left the studio altogether. Reading the URL also
 * makes the write after a `popstate` a replace for free: the URL already says
 * what the shell has just adopted, so there is no entry to push.
 */
export function historyModeFor(
  current: ShellUrlState,
  next: ShellUrlState,
): HistoryMode {
  return current.canvasOpen === next.canvasOpen ? "replace" : "push";
}

/**
 * Keep the shell's view state in the URL, and read it back on load.
 *
 * The initial value is read once. It is what a link restores, and after that
 * the shell owns the state — re-reading would fight the user every time they
 * moved anything. Coming BACK is the exception, and it is not a re-read: see
 * `parseShellUrlState` in `ValShell`'s popstate listener, which tells the shell
 * to adopt a state rather than merging one.
 */
export function useShellUrlState(): {
  initial: ShellUrlState;
  write: (state: ShellUrlState, history?: HistoryMode) => void;
} {
  const [initial] = useState<ShellUrlState>(() =>
    parseShellUrlState(
      typeof window === "undefined" ? "" : window.location.search,
    ),
  );

  const write = useCallback(
    (state: ShellUrlState, history: HistoryMode = "replace") => {
      if (typeof window === "undefined") return;
      const search = applyShellUrlState(window.location.search, state);
      const target = `${window.location.pathname}${search}${window.location.hash}`;
      if (
        target ===
        `${window.location.pathname}${window.location.search}${window.location.hash}`
      ) {
        return;
      }
      if (history === "push") {
        window.history.pushState(null, "", target);
      } else {
        window.history.replaceState(null, "", target);
      }
    },
    [],
  );

  return { initial, write };
}

/**
 * Write the state whenever it changes, throttled.
 *
 * Panning is a stream of values — a drag produces one per frame — and a
 * `replaceState` per frame is both wasteful and, in some browsers, rate
 * limited into silently dropping the ones that matter. The URL only has to be
 * right when someone comes to copy it.
 */
export function useWriteShellUrlState(
  write: (state: ShellUrlState, history?: HistoryMode) => void,
  state: ShellUrlState,
): void {
  const serialized = useMemo(() => JSON.stringify(state), [state]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = JSON.parse(serialized) as ShellUrlState;
      const current =
        typeof window === "undefined"
          ? next
          : parseShellUrlState(window.location.search);
      write(next, historyModeFor(current, next));
    }, 250);
    return () => clearTimeout(timer);
  }, [serialized, write]);
}
