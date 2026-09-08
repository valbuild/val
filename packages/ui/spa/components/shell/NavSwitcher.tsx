import { cn } from "../designSystem/cn";
import { visibleRailItems } from "./LeftRail";
import { ShellBreakpoint, ShellDestination, ShellPanel } from "./types";

/**
 * Whether the navigation panels have to carry a destination switcher.
 *
 * Anywhere the left rail is not drawn, which is everything below desktop. The
 * rail being desktop-only means that between 768px and 1200px — an iPad, a
 * half screen — the switcher is the ONLY way to get from one destination to
 * another: the top bar's menu button opens the first destination a project has
 * and nothing else, so Data, Media and Settings were unreachable at those
 * widths once Pages was open. Mobile had the switcher from the start; the
 * tablet breakpoint fell through the gap between the two.
 *
 * A predicate rather than a `breakpoint` prop on `NavSwitcher` itself, because
 * the caller has to be able to pass `undefined` for the panel's subheader: a
 * switcher that renders `null` still leaves `FloatingPanel` an empty bordered
 * band under the header.
 */
export function needsNavSwitcher(breakpoint: ShellBreakpoint): boolean {
  return breakpoint !== "desktop";
}

/**
 * The destination switcher shown at the top of every navigation panel wherever
 * the left rail is not drawn, standing in for it. See `needsNavSwitcher`.
 */
export function NavSwitcher({
  openPanel,
  onSelect,
  destinations,
}: {
  openPanel: ShellPanel | null;
  onSelect: (panel: ShellPanel) => void;
  /** The destinations this project has content for. See `LeftRailProps`. */
  destinations?: readonly ShellDestination[];
}) {
  const items = visibleRailItems(destinations);
  if (items.length < 2) {
    // One destination is not a choice, and a tab strip with a single tab in it
    // just takes a row off the top of every panel.
    return null;
  }
  return (
    <div
      role="tablist"
      aria-label="Destinations"
      className="flex gap-0.5 p-0.5 rounded-md bg-bg-float-raised"
    >
      {items.map(({ panel, label, icon: Icon }) => (
        <button
          key={panel}
          type="button"
          role="tab"
          aria-selected={openPanel === panel}
          onClick={() => onSelect(panel)}
          className={cn(
            "flex-1 inline-flex items-center justify-center gap-1.5 h-7 rounded text-[0.6875rem]",
            openPanel === panel
              ? "bg-bg-float text-fg-primary shadow-sm font-medium"
              : "text-fg-secondary",
          )}
        >
          <Icon size={13} />
          {label}
        </button>
      ))}
    </div>
  );
}
