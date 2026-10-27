import { ChevronLeft } from "lucide-react";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { cn } from "./designSystem/cn";
import { useNavLink } from "./navLink";

/**
 * The way back, under the heading: one link, to the parent, by its name.
 *
 * This line used to be a breadcrumb — `/products/product-1 / < sections`, every
 * path segment above you, the last one with an arrow. It read as a location and
 * behaved as one link: every segment between the page and a section of it
 * opened the same page, because `getNavPath` resolves them all there. So the
 * trail offered several labels for one destination, and labelled the one that
 * mattered with a field name (`sections`) instead of the thing it opened.
 *
 * What it is now is the answer to "where does going back take me?", and that
 * answer has a name:
 *
 * 1. **The parent is where the parent is SHOWN.** Not the path segment above —
 *    `sections` is a field of the page, and nobody edits it anywhere but on
 *    the page — but the nearest level above whose `getNavPath` destination is
 *    somewhere else. {@link parentDestination} is that walk.
 * 2. **Its name is its TITLE.** The link refers to a thing, so it is named the
 *    way every reference is: `describePath`, preview first. "‹ Product 1",
 *    not "‹ sections".
 * 3. **A link, not a button,** so it middle-clicks into a new tab and shows its
 *    destination on hover. Just the name and a chevron — no "Back to": the
 *    chevron says which way it goes, and nudges that way on hover. Screen
 *    readers get the words, as the link's label.
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
 * Where "back" goes from `path`: where the level above it is SHOWN, or `null`
 * when there is no level above it.
 *
 * `parts` is everything ABOVE the current thing, in order — what
 * `splitIntoInitAndLastParts` produces, after `scopePartsBelowPageRouter`.
 * The nearest one wins, resolved through `getNavPath`: from
 * `"/products/product-1"."sections".0` the level above is `sections`, and
 * `sections` is edited on the page — so the parent is the page. Folders are
 * skipped, being no place at all, and so is a level that resolves back to
 * `path` itself.
 */
export function parentDestination(
  parts: readonly ScopePart[],
  path: SourcePath,
  getNavPath: (
    path: SourcePath | ModuleFilePath,
  ) => SourcePath | ModuleFilePath | null,
): SourcePath | ModuleFilePath | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part.isDirectory) {
      continue;
    }
    const destination = getNavPath(part.sourcePath);
    if (destination !== null && destination !== path) {
      return destination;
    }
  }
  return null;
}

/**
 * "‹ Product 1", as a link.
 *
 * Presentational: `name` is whatever `describePath` called the destination,
 * which `Module` looks up, so this draws in a test with no store behind it.
 */
export function BackLink({
  to,
  name,
  className,
}: {
  to: SourcePath | ModuleFilePath;
  name: string;
  className?: string;
}) {
  const link = useNavLink(to);
  return (
    <nav aria-label="Back" className={cn("flex min-w-0", className)}>
      <a
        {...link}
        title={to}
        aria-label={`Back to ${name}`}
        className={cn(
          // Pulled left by the chevron's own side bearing, so the glyph — not
          // its box — lines up with the heading above.
          "group -ml-[3px] inline-flex min-w-0 items-center gap-0.5 rounded-sm text-fg-tertiary transition-colors hover:text-fg-primary",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
        )}
      >
        <ChevronLeft
          size={14}
          aria-hidden
          className="shrink-0 transition-transform group-hover:-translate-x-0.5"
        />
        <span className="truncate">{name}</span>
      </a>
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
