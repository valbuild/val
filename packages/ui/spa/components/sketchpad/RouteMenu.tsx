import { Eye, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../designSystem/cn";
import type { RouteMenuRequest } from "./routeNodeView";

/**
 * The menu a route divider opens: show its page beside the sketch, point it
 * at another of the site's routes, or take it out. Small and beside the
 * divider rather than a dialog over everything: what it is about -- the
 * sketch and the page -- stays in view.
 */
export function RouteMenu({
  menu,
  routes,
  onShow,
  onClose,
}: {
  menu: RouteMenuRequest;
  routes: string[];
  onShow: (route: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
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

  const width = 288;
  const left = Math.max(
    8,
    Math.min(
      rect.left + rect.width / 2 - width / 2,
      window.innerWidth - width - 8,
    ),
  );
  const top = Math.min(rect.bottom + 6, window.innerHeight - 320);
  const matches = routes.filter((route) =>
    route.toLowerCase().includes(query.trim().toLowerCase()),
  );
  // What was typed, as a route: a page the site does not have yet, to sketch.
  const typed = query.trim().replace(/\s+/g, "-");
  const newRoute =
    typed === "" ? null : typed.startsWith("/") ? typed : `/${typed}`;
  const isNew = newRoute !== null && !routes.includes(newRoute);

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
          <div className="px-2 pb-1 text-[11px] font-medium text-fg-secondary">
            Change page
          </div>
          <label className="mx-1 mb-1 flex items-center gap-1.5 rounded-md border border-border-primary px-2">
            <Search className="h-3.5 w-3.5 text-fg-tertiary" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Find a page, or type a new one"
              placeholder="Find a page, or type a new one"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const pick =
                  matches.length === 1 && !isNew ? matches[0] : newRoute;
                if (pick) {
                  menu.change(pick);
                  onClose();
                }
              }}
              className="h-7 flex-1 bg-transparent text-xs outline-none"
            />
          </label>
          <ul className="max-h-40 overflow-auto">
            {matches.map((route) => (
              <li key={route}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={route === menu.route}
                  onClick={() => {
                    menu.change(route);
                    onClose();
                  }}
                  className={cn(
                    "flex h-7 w-full cursor-pointer items-center rounded-md px-2 text-left text-xs hover:bg-bg-secondary",
                    route === menu.route && "bg-bg-secondary font-semibold",
                  )}
                >
                  {route}
                </button>
              </li>
            ))}
            {isNew && newRoute && (
              <li>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    menu.change(newRoute);
                    onClose();
                  }}
                  className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-bg-secondary"
                >
                  <Plus className="h-3.5 w-3.5 text-fg-secondary" />
                  <span className="min-w-0 flex-1 truncate">
                    New page <span className="font-semibold">{newRoute}</span>
                  </span>
                </button>
              </li>
            )}
          </ul>
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
