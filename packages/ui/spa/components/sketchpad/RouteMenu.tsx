import { ChevronLeft, Eye, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../designSystem/cn";
import type { RouteMenuRequest } from "./routeNodeView";
import {
  fillRoute,
  isRoutePattern,
  normalizeRoute,
  routeFitsPattern,
  routeSegments,
} from "./routePatterns";

/**
 * The menu a route divider opens: show its page beside the sketch, point it
 * at another route, or take it out. Small and beside the divider rather than
 * a dialog over everything: what it is about -- the sketch and the page --
 * stays in view.
 *
 * A route is a page the site has, or a new one. A new page starts from a
 * page type the site has (`/journal/[slug]`): pick the type, fill in its
 * parts, and the page fits what the site can render. Any other route can be
 * typed too.
 */
export function RouteMenu({
  menu,
  routes,
  onShow,
  onClose,
}: {
  menu: RouteMenuRequest;
  /** The site's routes: pages, and page types (`/journal/[slug]`). */
  routes: string[];
  onShow: (route: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [pattern, setPattern] = useState<string | null>(null);
  const [rect, setRect] = useState(() => menu.anchor.getBoundingClientRect());
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // Follows the chip as the sketch scrolls under it, and goes with it.
    const follow = () => {
      if (!menu.anchor.isConnected) {
        onClose();
        return;
      }
      setRect(menu.anchor.getBoundingClientRect());
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [onClose, menu.anchor]);

  const pick = (route: string) => {
    menu.change(route);
    onClose();
  };

  const width = 320;
  const left = Math.max(
    8,
    Math.min(
      rect.left + rect.width / 2 - width / 2,
      window.innerWidth - width - 8,
    ),
  );
  const top = Math.min(rect.bottom + 6, window.innerHeight - 380);

  return (
    <>
      {/* A click anywhere else closes it. */}
      <button
        type="button"
        aria-label="Close the route menu"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-overlay cursor-default"
      />
      <div
        ref={panel}
        role="menu"
        aria-label={`Route ${menu.route}`}
        style={{ left, top, width }}
        className="fixed z-overlay flex flex-col gap-1 rounded-lg border border-border-primary bg-bg-primary p-1.5 text-sm text-fg-primary shadow-lg"
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onShow(menu.route);
            onClose();
          }}
          className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-left font-medium hover:bg-bg-secondary"
        >
          <Eye className="h-4 w-4 text-fg-secondary" />
          Show <span className="font-semibold">{menu.route}</span> in the
          preview
        </button>
        <div className="mt-1 border-t border-border-primary pt-2">
          {pattern === null ? (
            <ChangePage
              current={menu.route}
              routes={routes}
              query={query}
              onQuery={setQuery}
              onPick={pick}
              onPattern={setPattern}
            />
          ) : (
            <NewPageOfType
              pattern={pattern}
              onBack={() => setPattern(null)}
              onPick={pick}
            />
          )}
        </div>
        <div className="mt-1 border-t border-border-primary pt-1">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              menu.remove();
              onClose();
            }}
            className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-fg-error-secondary hover:bg-bg-error-secondary"
          >
            <Trash2 className="h-4 w-4" />
            Remove
          </button>
        </div>
      </div>
    </>
  );
}

/** A route always starts with `/`: shown in front of the field, not typed. */
function RouteField({
  value,
  onChange,
  onEnter,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onEnter: () => void;
  label: string;
  placeholder: string;
}) {
  return (
    <label className="mx-1 mb-1 flex items-center rounded-md border border-border-primary focus-within:border-border-focus">
      <span
        aria-hidden
        className="flex h-7 items-center border-r border-border-primary bg-bg-secondary px-2 text-xs text-fg-secondary"
      >
        /
      </span>
      <input
        autoFocus
        value={value}
        // A pasted "/about" is "about" here: the slash is already there.
        onChange={(e) => onChange(e.target.value.replace(/^\/+/, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter();
          }
        }}
        aria-label={label}
        placeholder={placeholder}
        className="h-7 min-w-0 flex-1 bg-transparent px-2 text-xs outline-none"
      />
    </label>
  );
}

function ChangePage({
  current,
  routes,
  query,
  onQuery,
  onPick,
  onPattern,
}: {
  current: string;
  routes: string[];
  query: string;
  onQuery: (query: string) => void;
  onPick: (route: string) => void;
  onPattern: (pattern: string) => void;
}) {
  const needle = query.trim().toLowerCase();
  const pages = routes.filter(
    (route) => !isRoutePattern(route) && route.toLowerCase().includes(needle),
  );
  const types = routes.filter(
    (route) => isRoutePattern(route) && route.toLowerCase().includes(needle),
  );
  // What was typed, as a route: a page the site does not have yet.
  const typed = query.trim() === "" ? null : normalizeRoute(query);
  const isNew = typed !== null && !routes.includes(typed);
  const typeOfTyped =
    typed === null
      ? null
      : (routes.find(
          (route) => isRoutePattern(route) && routeFitsPattern(typed, route),
        ) ?? null);

  return (
    <>
      <div className="px-2 pb-1 text-[11px] font-medium text-fg-secondary">
        Change page
      </div>
      <RouteField
        value={query}
        onChange={onQuery}
        onEnter={() => {
          if (pages.length === 1 && types.length === 0 && !isNew) {
            onPick(pages[0]);
          } else if (typed) {
            onPick(typed);
          }
        }}
        label="Find a page, or type a new one"
        placeholder="Find a page, or type a new one"
      />
      <ul className="max-h-56 overflow-auto">
        {pages.map((route) => (
          <li key={route}>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={route === current}
              onClick={() => onPick(route)}
              className={cn(
                "flex h-7 w-full cursor-pointer items-center rounded-md px-2 text-left text-xs hover:bg-bg-secondary",
                route === current && "bg-bg-secondary font-semibold",
              )}
            >
              {route}
            </button>
          </li>
        ))}
        {types.length > 0 && (
          <li className="px-2 pb-0.5 pt-2 text-[11px] font-medium text-fg-secondary">
            Page types
          </li>
        )}
        {types.map((type) => (
          <li key={type}>
            <button
              type="button"
              role="menuitem"
              onClick={() => onPattern(type)}
              className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-bg-secondary"
            >
              <Plus className="h-3.5 w-3.5 text-fg-secondary" />
              <span className="min-w-0 flex-1 truncate">
                New <span className="font-semibold">{type}</span> page
              </span>
            </button>
          </li>
        ))}
        {isNew && typed && (
          <li>
            <button
              type="button"
              role="menuitem"
              onClick={() => onPick(typed)}
              className="flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-bg-secondary"
            >
              <Plus className="h-3.5 w-3.5 shrink-0 text-fg-secondary" />
              <span className="min-w-0 flex-1 break-all">
                New page <span className="font-semibold">{typed}</span>
                {typeOfTyped && (
                  <span className="block text-[11px] text-fg-tertiary">
                    a {typeOfTyped} page
                  </span>
                )}
              </span>
            </button>
          </li>
        )}
      </ul>
    </>
  );
}

/**
 * A new page of a type the site has: its fixed parts as they are, and a
 * field for each part that names the page -- `/journal/` and then the slug.
 */
function NewPageOfType({
  pattern,
  onBack,
  onPick,
}: {
  pattern: string;
  onBack: () => void;
  onPick: (route: string) => void;
}) {
  const segments = routeSegments(pattern);
  const [values, setValues] = useState<Record<string, string>>({});
  const route = fillRoute(pattern, values);
  const firstParam = segments.findIndex((s) => s.kind === "param");
  return (
    <form
      className="flex flex-col gap-2 px-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (route) onPick(route);
      }}
    >
      <button
        type="button"
        onClick={onBack}
        className="flex cursor-pointer items-center gap-1 self-start rounded px-1 text-[11px] font-medium text-fg-secondary hover:text-fg-primary"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> New{" "}
        <span className="font-semibold">{pattern}</span> page
      </button>
      <div className="flex flex-wrap items-center gap-0.5 rounded-md border border-border-primary bg-bg-secondary p-1 text-xs">
        <span className="px-0.5 text-fg-secondary">/</span>
        {segments.map((segment, i) => (
          <span key={i} className="flex items-center gap-0.5">
            {i > 0 && <span className="px-0.5 text-fg-secondary">/</span>}
            {segment.kind === "static" ? (
              <span className="text-fg-secondary">{segment.text}</span>
            ) : (
              <input
                autoFocus={i === firstParam}
                value={values[segment.name] ?? ""}
                onChange={(e) =>
                  setValues({ ...values, [segment.name]: e.target.value })
                }
                aria-label={segment.name}
                placeholder={
                  segment.optional ? `${segment.name}?` : segment.name
                }
                className="h-6 w-28 rounded border border-border-primary bg-bg-primary px-1.5 outline-none focus:border-border-focus"
              />
            )}
          </span>
        ))}
      </div>
      <button
        type="submit"
        disabled={!route}
        className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border-primary text-xs font-medium hover:bg-bg-secondary disabled:cursor-default disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" />
        {route ? (
          <>
            Add <span className="font-semibold">{route}</span>
          </>
        ) : (
          "Fill in the page's name"
        )}
      </button>
    </form>
  );
}
