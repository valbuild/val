import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { cn } from "./designSystem/cn";
import { useNavLink } from "./navLink";
import { useRefPreview } from "./useRefPreview";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./designSystem/dropdown-menu";

/**
 * Where you are, as somewhere you can go.
 *
 * The header used to render this as plain text: the breadcrumbs were labels, and
 * the ones that collapsed into the overflow menu were rendered `disabled`. So
 * there was no way up the scope at all — from a field inside a record inside a
 * router, the only ways back were the browser's back button and the Pages panel.
 *
 * Three rules hold everywhere this appears, because a path that behaves
 * differently in two places is worse than one that behaves poorly in both:
 *
 * 1. **Links, not buttons.** Every segment is an `<a href>` with the URL the
 *    navigation would go to, so it middle-clicks into a new tab, offers "Copy
 *    link address", and shows its destination on hover. `hrefOf` builds that URL
 *    with the same function `navigate` uses, so a link cannot advertise one
 *    destination and take you to another.
 * 2. **One arrow, on the segment it means.** There is exactly one
 *    {@link ChevronLeft} on the line and it belongs to the last segment, which
 *    is the parent — so the arrow and the thing it goes up to are the same
 *    link, with the same label. An arrow at the head of the line pointed at a
 *    destination three segments away from it. Separators are plain slashes,
 *    which are not directional and so cannot be mistaken for it.
 * 3. **The parent's own title.** Not the raw key: `useRefPreview` resolves the
 *    title a record entry is shown under everywhere else in the studio, so the
 *    scope names the parent the way the navigation named it.
 */
export type ScopePart = {
  /** What the path segment is called, before a render override improves on it. */
  text: string;
  sourcePath: SourcePath;
};

/**
 * One segment, as a link.
 *
 * `isParent` adds the up arrow: the last segment of the trail is the level
 * directly above what is being edited, so it is both the last thing you read
 * and the thing you press to go up. One link, one label, one arrow.
 */
function ScopeLink({
  part,
  isParent,
  className,
}: {
  part: ScopePart;
  isParent?: boolean;
  className?: string;
}) {
  const link = useNavLink(part.sourcePath);
  /**
   * The title the rest of the studio shows for this path.
   *
   * A record entry's key is `blog1`; the nav row, the reference list and the
   * search results all call it "Blog 1", because the schema's `render.select`
   * says so. The scope has to agree with them — a path whose segments do not
   * match the names they were clicked under reads as a different path.
   */
  const preview = useRefPreview(part.sourcePath);
  const label = preview?.title?.trim() || part.text;
  return (
    <a
      {...link}
      title={part.sourcePath}
      aria-label={isParent ? `Up one level, to ${label}` : undefined}
      className={cn(
        "inline-flex min-w-0 items-center gap-0.5 rounded-sm text-fg-tertiary hover:text-fg-brand-primary hover:underline",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        className,
      )}
    >
      {isParent && <ChevronLeft size={14} aria-hidden className="shrink-0" />}
      <span className="truncate">{label}</span>
    </a>
  );
}

/** The separator. Not an arrow — the line has exactly one of those. */
function ScopeSeparator() {
  return (
    <span aria-hidden className="shrink-0 text-fg-quaternary">
      /
    </span>
  );
}

/**
 * A collapsed level, as a link in the overflow menu.
 *
 * `asChild` so the menu item IS the anchor: the levels hidden in here are
 * exactly the ones too far up to reach any other way, and they were previously
 * rendered `disabled` — a breadcrumb that lists where you came from and refuses
 * to take you there.
 */
function ScopeMenuLink({ part }: { part: ScopePart }) {
  const link = useNavLink(part.sourcePath);
  const preview = useRefPreview(part.sourcePath);
  return (
    <DropdownMenuItem asChild className="gap-1.5">
      <a {...link} title={part.sourcePath}>
        <ScopeSeparator />
        <span className="truncate">{preview?.title?.trim() || part.text}</span>
      </a>
    </DropdownMenuItem>
  );
}

/**
 * How many segments are shown before the middle collapses.
 *
 * The first and the last two are what a reader uses — the module they are in and
 * the two steps above them; the ones between are depth rather than orientation.
 */
const MAX_VISIBLE = 3;

/**
 * The scope line: the trail that leads here, ending in the way back up.
 *
 * `parts` is everything ABOVE the current thing, in order, which is what
 * `splitIntoInitAndLastParts` already produces — see `Module`.
 */
export function ScopeTrail({
  parts,
  portalContainer,
  className,
}: {
  parts: readonly ScopePart[];
  portalContainer: HTMLElement | null;
  className?: string;
}) {
  const parent = parts.length > 0 ? parts[parts.length - 1] : null;
  const { visibleStart, collapsed, visibleEnd } = useMemo(() => {
    if (parts.length <= MAX_VISIBLE) {
      return { visibleStart: parts, collapsed: [], visibleEnd: [] };
    }
    return {
      visibleStart: parts.slice(0, 1),
      collapsed: parts.slice(1, -2),
      visibleEnd: parts.slice(-2),
    };
  }, [parts]);

  if (parent === null) {
    return null;
  }

  return (
    <nav
      aria-label="Scope"
      className={cn(
        "flex min-w-0 items-center gap-1 text-xs text-fg-quaternary",
        className,
      )}
    >
      {visibleStart.map((part, index) => (
        <span
          key={part.sourcePath + index}
          className="flex min-w-0 items-center gap-1"
        >
          <ScopeLink part={part} isParent={part === parent} />
          {(collapsed.length > 0 ||
            visibleEnd.length > 0 ||
            index < visibleStart.length - 1) && <ScopeSeparator />}
        </span>
      ))}

      {collapsed.length > 0 && (
        <span className="flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`${collapsed.length} more levels`}
              className="rounded-sm px-0.5 text-fg-tertiary hover:text-fg-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              …
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" container={portalContainer}>
              {/*
               * Destinations, not labels. These were rendered `disabled`, which
               * is the one thing a collapsed breadcrumb must not be: the levels
               * hidden here are exactly the ones too far to reach any other way.
               */}
              {collapsed.map((part) => (
                <ScopeMenuLink key={part.sourcePath} part={part} />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <ScopeSeparator />
        </span>
      )}

      {visibleEnd.map((part, index) => (
        <span
          key={part.sourcePath + index}
          className="flex min-w-0 items-center gap-1"
        >
          <ScopeLink part={part} isParent={part === parent} />
          {index < visibleEnd.length - 1 && <ScopeSeparator />}
        </span>
      ))}
    </nav>
  );
}

/**
 * Whether the thing this ref is on has been scrolled up out of view.
 *
 * Used to reveal {@link StickyScopeBar} only once the real header is gone —
 * otherwise the two would be on screen at the same time, and the column would
 * open with the title written twice.
 *
 * A plain {@link IntersectionObserver} with no root is right even though the
 * scroller is a column rather than the window: intersection is computed against
 * every clipping ancestor, so an element scrolled out of its own scroller stops
 * intersecting.
 */
export function useScrolledPast(): [
  (node: HTMLElement | null) => void,
  boolean,
] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [past, setPast] = useState(false);
  useEffect(() => {
    if (node === null) {
      setPast(false);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        // Above the viewport, not merely outside it: a column that is off screen
        // sideways (the canvas pane) must not condense its header.
        setPast(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      }
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [node]);
  return [setNode, past];
}

/**
 * The header, once it has been scrolled past.
 *
 * A long module puts its own header out of reach: by the time you are editing
 * the tenth field, "up" is a scroll away, and the way back is the thing you are
 * most likely to want. So the header collapses to one line and stays.
 *
 * Two details are what make it not annoying:
 *
 * - It is revealed, not always there. While the real header is on screen this
 *   renders nothing you can see — see {@link useScrolledPast}.
 * - Its flow box is zero-height, so revealing it moves no content. It floats
 *   over the fields the way the shell's own chrome does, rather than pushing
 *   the column down by its own height the moment you scroll.
 *
 * The same arrow and the same link treatment as the full header — see
 * {@link ScopeTrail}.
 */
export function StickyScopeBar({
  parent,
  title,
  trailing,
  visible,
}: {
  /** The parent to go up to, or null at the top of a module. */
  parent: ScopePart | null;
  /** What is being edited, so the bar says where it belongs to. */
  title: ReactNode;
  /** The record tools, which stay reachable while scrolled. */
  trailing?: ReactNode;
  /** Whether the real header is out of view. */
  visible: boolean;
}) {
  /**
   * How far down the bar sticks.
   *
   * The column runs up underneath the shell's floating top bar, so a bar stuck
   * flush to the scroller's top edge is behind the chrome — which is what it
   * did: one sliver of a chevron showing under the project name. The layout
   * already publishes how much is covering the column, for the same reason and
   * for the same scroller, as `data-scroll-clearance` — see `PageWorkspace`.
   */
  const [top, setTop] = useState(0);
  const measure = useCallback((node: HTMLElement | null) => {
    const scroller = node?.closest("[data-scroll-clearance]");
    const clearance = Number(scroller?.getAttribute("data-scroll-clearance"));
    setTop(Number.isFinite(clearance) ? clearance : 0);
  }, []);

  return (
    <div ref={measure} style={{ top }} className="sticky z-hover h-0">
      <div
        aria-hidden={!visible}
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border-primary bg-bg-primary/95 px-2 py-1.5 shadow-lg backdrop-blur",
          "transition-opacity duration-150",
          // `invisible` rather than only a zero opacity: an unseen bar must not
          // be in the tab order or take clicks meant for the field under it.
          visible ? "visible opacity-100" : "invisible opacity-0",
        )}
      >
        {parent !== null && (
          <ScopeTrail
            parts={[parent]}
            portalContainer={null}
            className="shrink-0"
          />
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-fg-primary">
          {title}
        </span>
        {trailing && <span className="shrink-0">{trailing}</span>}
      </div>
    </div>
  );
}

/** For a path that is a module file with no module path — see `Module`. */
export function moduleFileScopePart(
  moduleFilePath: ModuleFilePath,
  text: string,
): ScopePart {
  return { text, sourcePath: moduleFilePath as unknown as SourcePath };
}
