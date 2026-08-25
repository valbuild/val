import { useMemo, useState } from "react";
import { Internal, SourcePath } from "@valbuild/core";
import { Search } from "lucide-react";
import { cn } from "../../designSystem/cn";
import { prettifyFilename } from "../../../utils/prettifyFilename";

/**
 * What Val found on the page, as a list you can work down.
 *
 * This is the app's fields view, and deliberately less than the designed one:
 * the page reports the *paths* of the content on it — that is all a
 * `data-val-path` attribute carries — so this can say which fields are there
 * and open any of them, but not show or edit their values in place. The mocked
 * `FieldsPanel` shows where that is going; this is what is true today, and a
 * list of the right things beats a list of invented ones.
 *
 * Grouped by module, because a page is usually assembled from several: its own
 * route module plus whatever it pulls in — a footer, a settings record, an
 * author. Seeing that split is most of the value of looking at the page this
 * way.
 */
export function CanvasPathList({
  paths,
  onSelect,
  isDevMode,
}: {
  paths: readonly SourcePath[];
  onSelect?: (path: SourcePath) => void;
  /** Show the full source path under each row. */
  isDevMode?: boolean;
}) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const byModule = new Map<string, SourcePath[]>();
    for (const path of paths) {
      const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
      const existing = byModule.get(moduleFilePath);
      if (existing) {
        existing.push(path);
      } else {
        byModule.set(moduleFilePath, [path]);
      }
    }
    return Array.from(byModule.entries()).map(([moduleFilePath, entries]) => ({
      moduleFilePath,
      label: prettifyFilename(
        moduleFilePath.split("/").pop() ?? moduleFilePath,
      ),
      entries,
    }));
  }, [paths]);

  const filtered = useMemo(() => {
    if (!query) return groups;
    const q = query.toLowerCase();
    return groups
      .map((group) => ({
        ...group,
        entries: group.entries.filter((path) => path.toLowerCase().includes(q)),
      }))
      .filter((group) => group.entries.length > 0);
  }, [groups, query]);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border-float bg-bg-float">
      <div className="shrink-0 border-b border-border-float px-3 py-2.5">
        <h2 className="text-[0.8125rem] font-medium text-fg-primary">
          On this page
          <span className="ml-1.5 font-normal text-fg-secondary-alt">
            {paths.length}
          </span>
        </h2>
        <p className="mt-1 text-[0.6875rem] leading-relaxed text-fg-secondary-alt">
          Click a field to open it in the editor, or click it on the page.
        </p>
      </div>
      <div className="shrink-0 border-b border-border-float px-2 py-2">
        <div className="flex items-center gap-1.5 rounded-md bg-bg-float-raised px-2 h-7">
          <Search size={12} className="shrink-0 text-fg-secondary-alt" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter fields…"
            aria-label="Filter fields"
            className="min-w-0 flex-1 bg-transparent text-xs text-fg-primary placeholder:text-fg-secondary-alt focus:outline-none"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim py-1.5">
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-fg-secondary-alt">
            {query
              ? "No fields match this filter."
              : "The page reported no editable content."}
          </p>
        ) : (
          filtered.map((group) => (
            <section key={group.moduleFilePath} className="mb-1">
              <h3
                title={group.moduleFilePath}
                className="px-3 pt-2 pb-1 text-[0.625rem] font-medium uppercase tracking-wide text-fg-secondary-alt"
              >
                {group.label}
              </h3>
              {group.entries.map((path) => (
                <button
                  key={path}
                  type="button"
                  onClick={() => onSelect?.(path)}
                  title={path}
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left",
                    "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
                  )}
                >
                  <span className="max-w-full truncate text-xs">
                    {fieldLabel(path)}
                  </span>
                  {isDevMode && (
                    <span className="max-w-full truncate font-mono text-[0.625rem] text-fg-secondary-alt">
                      {path}
                    </span>
                  )}
                </button>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * A readable name for a path.
 *
 * The module path's segments, minus the router key that every page under a
 * route shares — `"/"` or `"/blogs/blog1"` says which page you are on, which
 * you already know from being on it, and repeating it on every row pushes the
 * part that differs off the end.
 */
export function fieldLabel(path: SourcePath): string {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(path);
  if (!modulePath) return path;
  const segments = Internal.splitModulePath(modulePath);
  // A leading segment that looks like a URL is the router key.
  const withoutRouteKey =
    segments.length > 1 && segments[0].startsWith("/")
      ? segments.slice(1)
      : segments;
  if (withoutRouteKey.length === 0) return segments.join(" › ");
  return withoutRouteKey.join(" › ");
}
