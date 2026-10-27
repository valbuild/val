import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link2, X } from "lucide-react";
import { cn } from "../../designSystem/cn";
import { useDismissOnOutsidePointer } from "../useDismissOnOutsidePointer";

/**
 * The canvas's address bar.
 *
 * The canvas is a browser, and a browser shows you where you are. Two things
 * follow from that being useful rather than decorative: you can read the route
 * without guessing it from the page, and you can type one — including a route
 * Val knows nothing about, which is how you look at a page that has no content
 * module behind it yet.
 *
 * Relative only, and enforced rather than asked for. The frame is same-origin
 * with the studio, and that is what lets the studio talk to it at all: an
 * absolute URL to somewhere else would load a page that can never answer, and
 * the canvas would look broken for a reason nothing on screen explains.
 *
 * Autocomplete comes from the routes Val tracks, because those are the ones it
 * can say anything about — but it is a suggestion, not a constraint.
 */
/**
 * How many routes the list shows at once.
 *
 * Enough that a project's pages are usually all there, few enough that the list
 * stays a list. Whatever is left over is counted at the bottom.
 */
const MAX_SUGGESTIONS = 12;

export function CanvasRouteBar({
  value,
  routes,
  onChange,
  className,
}: {
  /** The route the canvas is showing, e.g. `/blogs/blog1`. */
  value: string;
  /** Routes Val tracks, offered as suggestions. */
  routes: readonly string[];
  onChange: (route: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // The canvas can be moved from elsewhere — picking another page — and the bar
  // has to follow. Only while it is not being typed in: overwriting a
  // half-typed route is worse than being briefly out of date.
  useEffect(() => {
    if (!isOpen) setDraft(value);
  }, [value, isOpen]);

  /**
   * The routes worth offering, best first.
   *
   * Ranked rather than filtered, because a plain `includes` puts the answer
   * anywhere: typing `/blogs/blog-3` matches both `/blogs/blog-3` and
   * `/blogs/blog-32`, and if the longer one happens to come first in the tree
   * then the highlighted option — the one Enter takes — is not the route that
   * was typed. Exact first, then routes that START with what was typed, then
   * the rest.
   */
  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return routes.slice(0, MAX_SUGGESTIONS);
    const rank = (route: string): number => {
      const candidate = route.toLowerCase();
      if (candidate === q) return 0;
      if (candidate.startsWith(q)) return 1;
      return 2;
    };
    return (
      routes
        .filter((route) => route.toLowerCase().includes(q))
        .map((route, index) => ({ route, index, rank: rank(route) }))
        // Ties keep the order they came in, which is the sorted route order.
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .slice(0, MAX_SUGGESTIONS)
        .map((entry) => entry.route)
    );
  }, [routes, draft]);

  const hiddenCount = useMemo(() => {
    const q = draft.trim().toLowerCase();
    const total = q
      ? routes.filter((route) => route.toLowerCase().includes(q)).length
      : routes.length;
    return Math.max(0, total - suggestions.length);
  }, [routes, draft, suggestions.length]);

  useEffect(() => setActiveIndex(0), [draft]);

  // Clicking anywhere else is a way out that does not commit — the same as
  // Escape, and the one people reach for first.
  const revert = useCallback(() => {
    setIsOpen(false);
    setDraft(value);
  }, [value]);
  useDismissOnOutsidePointer(containerRef, isOpen, revert);

  const commit = (route: string) => {
    const normalized = normalizeRoute(route);
    setIsOpen(false);
    setDraft(normalized);
    if (normalized !== value) onChange(normalized);
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="flex items-center gap-1.5 h-8 pl-2 pr-1 rounded-md border border-border-float bg-bg-float">
        <Link2 size={13} className="shrink-0 text-fg-secondary-alt" />
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setIsOpen(false);
              setDraft(value);
              event.currentTarget.blur();
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              // A highlighted suggestion wins over what is typed: the arrow
              // keys moved the highlight on purpose.
              const picked = isOpen ? suggestions[activeIndex] : undefined;
              commit(picked ?? draft);
              event.currentTarget.blur();
              return;
            }
            if (
              (event.key === "ArrowDown" || event.key === "ArrowUp") &&
              suggestions.length > 0
            ) {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((current) => {
                const next =
                  event.key === "ArrowDown" ? current + 1 : current - 1;
                return (next + suggestions.length) % suggestions.length;
              });
            }
          }}
          spellCheck={false}
          aria-label="Canvas route"
          placeholder="/"
          className="min-w-0 flex-1 bg-transparent font-mono text-[0.6875rem] text-fg-primary placeholder:text-fg-secondary-alt focus:outline-none"
        />
        {draft !== value && (
          <button
            type="button"
            aria-label="Discard the typed route"
            onClick={() => {
              setDraft(value);
              setIsOpen(false);
            }}
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-fg-secondary-alt hover:text-fg-primary"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {isOpen && suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label="Tracked routes"
          className="absolute left-0 right-0 top-full z-window mt-1 max-h-56 overflow-y-auto rounded-md border border-border-float bg-bg-float py-1 shadow-lg scrollbar-slim"
        >
          {suggestions.map((route, index) => (
            // Keyed by position as well as by route: two options with the same
            // key make React reuse one of them for the other's handler, which
            // is how picking a route came to commit its neighbour.
            <li key={`${index}-${route}`}>
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseMove={() => setActiveIndex(index)}
                // `onMouseDown`, not `onClick`: the input's blur would close
                // the list before a click ever landed on it.
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(route);
                }}
                className={cn(
                  "block w-full truncate px-2.5 py-1 text-left font-mono text-[0.6875rem]",
                  index === activeIndex
                    ? "bg-bg-float-raised text-fg-primary"
                    : "text-fg-secondary",
                )}
              >
                {route}
              </button>
            </li>
          ))}
          {hiddenCount > 0 && (
            // Said rather than silently dropped: a route missing from a list
            // that looks complete reads as Val not knowing about it.
            <li
              aria-hidden
              className="px-2.5 py-1 text-[0.625rem] text-fg-secondary-alt"
            >
              {hiddenCount} more — keep typing to narrow
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * A typed route, as a path on this host.
 *
 * An absolute URL is reduced to its path rather than rejected: pasting one is
 * the obvious thing to do, and the path is what was meant. A path that is not
 * rooted gets a leading slash for the same reason.
 */
export function normalizeRoute(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return "/";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return `${url.pathname}${url.search}${url.hash}` || "/";
    } catch {
      // Not parseable after all; fall through and treat it as a path.
    }
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
