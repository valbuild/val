import { useMemo } from "react";
import { ChevronLeft } from "lucide-react";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { cn } from "./designSystem/cn";
import { useNavLink } from "./navLink";
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
 * 3. **Path segments, never previews.** A `.preview(...)` is a TITLE — what a
 *    thing is called where it is shown as a thing: the heading, a card, a list
 *    row, a search hit. This line is not that. It is WHERE YOU ARE, and where
 *    you are is a path: `Content / Authors / teddy`, the folder, the module and
 *    the key, each as it is written. A trail that read
 *    `Content / Forfattere / Theodor René Carlsen` names three things and
 *    locates none of them — and it changes under an editor as they type, which
 *    is the one thing a location must not do.
 */
export type ScopePart = {
  /** What the path segment is called, before a render override improves on it. */
  text: string;
  sourcePath: SourcePath;
  /**
   * A folder in the module file path, which is not a place.
   *
   * `/content/authors.val.ts` reads as `Content / Authors`, and only `Authors` is
   * a thing you can open — `content` is a directory on disk with no editor
   * behind it. Both segments are handed the same `sourcePath` (the module), so
   * without this the trail offered two links to one destination and one of them
   * was labelled with a folder. Rendered as text instead.
   */
  isDirectory?: boolean;
};

/**
 * The trail for a path, with a PAGE's file location left out.
 *
 * `/app/blogs/[blog]/page.val.ts?p="/blogs/blog2"` used to read
 * `App / … / Blog / Pages / /blogs/blog2` — four segments saying where the
 * module is stored, then the one segment saying where the page is. Nobody
 * reaches a page that way: the Pages panel is a tree of ROUTES, and a route is
 * already the complete path. The file is provenance, and it stays on hover and
 * in the address bar.
 *
 * So inside a page router the trail starts below the module. For the page
 * itself that leaves nothing, and the heading's own route fills the line; for a
 * field inside a page it leaves the route and then the field.
 *
 * Not applied to the router module ITSELF — "Pages" has no route of its own, so
 * where its file is, is the only location it has.
 */
export function scopePartsBelowPageRouter(
  parts: readonly ScopePart[],
  moduleFilePath: string,
  isInsidePageRouter: boolean,
): ScopePart[] {
  if (!isInsidePageRouter) {
    return [...parts];
  }
  // Every module-file-path segment — the folders AND the module — is handed the
  // module's own path as its `sourcePath`. See `splitIntoInitAndLastParts`.
  return parts.filter((part) => (part.sourcePath as string) !== moduleFilePath);
}

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
  const label = part.text;
  if (part.isDirectory) {
    // Text, not a link: see `ScopePart.isDirectory`.
    return (
      <span className={cn("truncate text-fg-secondary-alt", className)}>
        {label}
      </span>
    );
  }
  return (
    <a
      {...link}
      title={part.sourcePath}
      aria-label={isParent ? `Up one level, to ${label}` : undefined}
      className={cn(
        "inline-flex min-w-0 items-center gap-0.5 rounded-sm text-fg-tertiary hover:text-fg-brand-primary hover:underline",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
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
    <span aria-hidden className="shrink-0 text-fg-secondary-alt">
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
  const label = part.text;
  if (part.isDirectory) {
    // A folder is not a destination here either — see `ScopePart.isDirectory`.
    return (
      <DropdownMenuItem disabled className="gap-1.5">
        <ScopeSeparator />
        <span className="truncate">{label}</span>
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem asChild className="gap-1.5">
      <a {...link} title={part.sourcePath}>
        <ScopeSeparator />
        <span className="truncate">{label}</span>
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
  /*
   * The parent, and only if going there means anything.
   *
   * The last segment above a module is its DIRECTORY — so on a module's own page
   * the arrow used to offer "up" to a folder, which is not a place: it navigated
   * to the module you were already on. No arrow there, and the folder reads as
   * the label it is.
   */
  const last = parts.length > 0 ? parts[parts.length - 1] : null;
  const parent = last !== null && last.isDirectory !== true ? last : null;
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

  if (last === null) {
    return null;
  }

  return (
    <nav
      aria-label="Scope"
      className={cn(
        "flex min-w-0 items-center gap-1 text-xs text-fg-secondary-alt",
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
              className="rounded-sm px-0.5 text-fg-tertiary hover:text-fg-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
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

/** For a path that is a module file with no module path — see `Module`. */
export function moduleFileScopePart(
  moduleFilePath: ModuleFilePath,
  text: string,
): ScopePart {
  return { text, sourcePath: moduleFilePath as unknown as SourcePath };
}
