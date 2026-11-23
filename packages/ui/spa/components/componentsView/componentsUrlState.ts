import type { CanvasDevice } from "../shell/canvas/types";

/**
 * The screen a component is laid out at: the canvas's own widths
 * (`CANVAS_DEVICE_WIDTHS`), so a component here is the width it is there.
 */
export type Device = CanvasDevice;

const SCREENS: readonly Device[] = ["desktop", "tablet", "mobile"];

/**
 * What the Components view is showing, kept in the address so it can be
 * sent to someone ("look at the third hero on a phone") and comes back with
 * the back button.
 */
export type ComponentsUrlState = {
  /**
   * What is listed: every component (`components`), or the pages, each with
   * the components it uses stacked as its content has them (`pages`).
   */
  mode: "components" | "pages";
  /** In `pages`: the page open, by `ComponentPage.key`. */
  page: string | null;
  /** In `pages`: the use picked on it, whose fields Content shows. */
  block: string | null;
  /** The component open, by `StudioComponent.id`, or the board. */
  component: string | null;
  /** Which of its uses, by position. */
  instance: number;
  /** Its example rather than a use. */
  example: boolean;
  /** One use at a time, or all of them side by side. */
  layout: "one" | "all";
  device: Device;
};

/**
 * The query parameters the view owns: dropped when navigating anywhere else
 * (`ROUTE_OWNED_PARAMS` in `ValRouter`).
 */
export const COMPONENTS_URL_PARAMS: readonly string[] = [
  "mode",
  "page",
  "block",
  "component",
  "use",
  "example",
  "layout",
  "screen",
];

const DEFAULT_DEVICE: Device = "desktop";

export function readComponentsUrlState(search: string): ComponentsUrlState {
  const params = new URLSearchParams(search);
  const use = Number(params.get("use") ?? "1");
  const screen = params.get("screen");
  return {
    mode: params.get("mode") === "pages" ? "pages" : "components",
    page: params.get("page"),
    block: params.get("block"),
    component: params.get("component"),
    instance: Number.isInteger(use) && use >= 1 ? use - 1 : 0,
    example: params.get("example") === "1",
    layout: params.get("layout") === "all" ? "all" : "one",
    device: SCREENS.find((option) => option === screen) ?? DEFAULT_DEVICE,
  };
}

/** The query for a state: only what differs from the defaults. */
export function componentsUrlSearch(
  state: ComponentsUrlState,
  current: string,
): string {
  const params = new URLSearchParams(current);
  for (const name of COMPONENTS_URL_PARAMS) {
    params.delete(name);
  }
  if (state.mode === "pages") {
    params.set("mode", "pages");
    if (state.page !== null) params.set("page", state.page);
    if (state.page !== null && state.block !== null) {
      params.set("block", state.block);
    }
  } else if (state.component !== null) {
    params.set("component", state.component);
    if (state.instance > 0) params.set("use", String(state.instance + 1));
    if (state.example) params.set("example", "1");
    if (state.layout === "all") params.set("layout", "all");
  }
  if (state.device !== DEFAULT_DEVICE) params.set("screen", state.device);
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

/**
 * Write a state to the address. Opening a component, or going back to the
 * board, is a step the back button undoes; the rest replace the entry.
 */
export function writeComponentsUrlState(state: ComponentsUrlState) {
  const search = componentsUrlSearch(state, window.location.search);
  if (search === window.location.search) return;
  const before = readComponentsUrlState(window.location.search);
  const target = `${window.location.pathname}${search}${window.location.hash}`;
  if (
    before.component !== state.component ||
    before.mode !== state.mode ||
    before.page !== state.page
  ) {
    window.history.pushState(null, "", target);
  } else {
    window.history.replaceState(null, "", target);
  }
}

/*
 * One state for the two halves of the view - the stage, in the preview's
 * place, and the Content pane beside it - read from the address and written
 * back to it. Module-level, like the address it mirrors: there is one.
 */
let current: ComponentsUrlState | null = null;
const listeners = new Set<() => void>();

function snapshot(): ComponentsUrlState {
  if (current === null) {
    current = readComponentsUrlState(
      typeof window === "undefined" ? "" : window.location.search,
    );
  }
  return current;
}

function emit() {
  for (const listener of listeners) listener();
}

function onPopState() {
  current = readComponentsUrlState(window.location.search);
  emit();
}

/** For `useSyncExternalStore`. Reads the address again for a first listener: it may have been navigated to since. */
export function subscribeComponentsUrlState(listener: () => void) {
  if (listeners.size === 0 && typeof window !== "undefined") {
    current = readComponentsUrlState(window.location.search);
    window.addEventListener("popstate", onPopState);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("popstate", onPopState);
    }
  };
}

export function getComponentsUrlState(): ComponentsUrlState {
  return snapshot();
}

export function updateComponentsUrlState(next: Partial<ComponentsUrlState>) {
  const merged = { ...snapshot(), ...next };
  writeComponentsUrlState(merged);
  current = merged;
  emit();
}
