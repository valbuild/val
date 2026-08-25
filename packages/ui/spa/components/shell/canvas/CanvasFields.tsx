import { useMemo, useState } from "react";
import { Internal, SourcePath } from "@valbuild/core";
import { Search } from "lucide-react";
import { cn } from "../../designSystem/cn";
import { prettifyFilename } from "../../../utils/prettifyFilename";
import { AnyField } from "../../AnyField";
import { FieldLoading } from "../../FieldLoading";
import { FieldNotFound } from "../../FieldNotFound";
import { FieldSchemaError } from "../../FieldSchemaError";
import { useSchemaAtPath } from "../../ValFieldProvider";

/**
 * The fields the page reported, as fields rather than as a list of paths.
 *
 * This is the point of the fields view: instead of hunting across a page for
 * the thing you want to change, the page's content is a column you read top to
 * bottom and edit in place, and the canvas beside it is for seeing the result
 * rather than for aiming at it.
 *
 * They are Val's own field components, not a rendering of the values the page
 * happened to report. A `data-val-path` carries a path and nothing else — no
 * value, no schema, no validation — so anything built from the attribute alone
 * would be a read-only imitation of an editor. Asking Val for the schema at
 * each path gives the real one, with the real validation and the real patches.
 *
 * Grouped by module, because a page is usually assembled from several: its own
 * route module plus whatever it pulls in — a footer, a settings record, an
 * author. Seeing that split is most of the value of looking at a page this way.
 */
export function CanvasFields({
  paths,
  selectedPath,
  onSelect,
  isDevMode,
}: {
  paths: readonly SourcePath[];
  /** The field the editor is on, highlighted here to match. */
  selectedPath?: SourcePath | null;
  onSelect?: (path: SourcePath) => void;
  /** Show the full source path under each field. */
  isDevMode?: boolean;
}) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const byModule = new Map<string, SourcePath[]>();
    for (const path of paths) {
      const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
      const existing = byModule.get(moduleFilePath);
      if (existing) existing.push(path);
      else byModule.set(moduleFilePath, [path]);
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
    const q = query.trim().toLowerCase();
    if (!q) return groups;
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
          Edit here, or click an element on the page.
        </p>
      </div>
      <div className="shrink-0 border-b border-border-float px-2 py-2">
        <div className="flex h-7 items-center gap-1.5 rounded-md bg-bg-float-raised px-2">
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
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim px-2 py-2">
        {filtered.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-fg-secondary-alt">
            {query
              ? "No fields match this filter."
              : "The page reported no editable content."}
          </p>
        ) : (
          filtered.map((group) => (
            <section key={group.moduleFilePath} className="mb-3">
              <h3
                title={group.moduleFilePath}
                className="truncate px-1 pb-1.5 text-[0.625rem] font-medium uppercase tracking-wide text-fg-secondary-alt"
              >
                {group.label}
              </h3>
              <div className="space-y-2">
                {group.entries.map((path) => (
                  <CanvasFieldRow
                    key={path}
                    path={path}
                    selected={selectedPath === path}
                    onSelect={onSelect}
                    isDevMode={isDevMode}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * One field.
 *
 * Its own component so it can ask for its own schema: the list is dynamic, and
 * hooks cannot be called in a loop over it. That also means each field resolves
 * and re-renders independently, which is what keeps one slow module from
 * holding up the rest of the column.
 */
function CanvasFieldRow({
  path,
  selected,
  onSelect,
  isDevMode,
}: {
  path: SourcePath;
  selected: boolean;
  onSelect?: (path: SourcePath) => void;
  isDevMode?: boolean;
}) {
  const schemaAtPath = useSchemaAtPath(path);
  return (
    <div
      onFocusCapture={() => onSelect?.(path)}
      className={cn(
        "rounded-lg border px-2.5 py-2",
        selected
          ? "border-border-brand-primary bg-bg-float-raised"
          : "border-border-float",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect?.(path)}
        title={path}
        className="mb-1.5 block max-w-full truncate text-left text-[0.8125rem] font-medium text-fg-primary"
      >
        {fieldLabel(path)}
      </button>
      {schemaAtPath.status === "error" ? (
        <FieldSchemaError
          path={path}
          error={schemaAtPath.error}
          type="module"
        />
      ) : schemaAtPath.status === "loading" ? (
        <FieldLoading path={path} type="module" />
      ) : schemaAtPath.status === "not-found" ? (
        <FieldNotFound path={path} type="module" />
      ) : (
        // `compact`, because this column is a third of the workspace at most:
        // the field has to be the editor, not the editor's full layout.
        <AnyField path={path} schema={schemaAtPath.data} compact />
      )}
      {isDevMode && (
        <p className="mt-1.5 max-w-full truncate font-mono text-[0.625rem] text-fg-secondary-alt">
          {path}
        </p>
      )}
    </div>
  );
}

/**
 * A readable name for a path.
 *
 * The module path's segments, minus the router key that every field on a page
 * shares — `"/"` or `"/blogs/blog1"` says which page you are on, which you
 * already know from being on it, and repeating it on every row pushes the part
 * that differs off the end.
 */
export function fieldLabel(path: SourcePath): string {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(path);
  if (!modulePath) return path;
  const segments = Internal.splitModulePath(modulePath);
  const withoutRouteKey =
    segments.length > 1 && segments[0].startsWith("/")
      ? segments.slice(1)
      : segments;
  if (withoutRouteKey.length === 0) return segments.join(" › ");
  return withoutRouteKey.join(" › ");
}
