/**
 * The screens a component can be laid out at in the Components view.
 * Mobile first: the narrowest, and the one most often broken.
 */
export type Device = "mobile" | "tablet" | "desktop";

export const DEVICES: readonly {
  device: Device;
  label: string;
  width: number;
}[] = [
  { device: "mobile", label: "Phone", width: 390 },
  { device: "tablet", label: "Tablet", width: 820 },
  { device: "desktop", label: "Desktop", width: 1280 },
];

/**
 * What the Components view is showing, kept in the address so it can be
 * sent to someone ("look at the third hero on a phone") and comes back with
 * the back button.
 */
export type ComponentsUrlState = {
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
export const COMPONENTS_URL_PARAMS = [
  "component",
  "use",
  "example",
  "layout",
  "screen",
] as const;

const DEFAULT_DEVICE: Device = "desktop";

export function readComponentsUrlState(search: string): ComponentsUrlState {
  const params = new URLSearchParams(search);
  const use = Number(params.get("use") ?? "1");
  const screen = params.get("screen");
  return {
    component: params.get("component"),
    instance: Number.isInteger(use) && use >= 1 ? use - 1 : 0,
    example: params.get("example") === "1",
    layout: params.get("layout") === "all" ? "all" : "one",
    device:
      DEVICES.find((option) => option.device === screen)?.device ??
      DEFAULT_DEVICE,
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
  if (state.component !== null) {
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
  if (before.component !== state.component) {
    window.history.pushState(null, "", target);
  } else {
    window.history.replaceState(null, "", target);
  }
}
