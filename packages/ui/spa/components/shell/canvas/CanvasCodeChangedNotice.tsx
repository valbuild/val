import type { ModuleFilePath } from "@valbuild/core";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { cn } from "../../designSystem/cn";

/**
 * The page in the canvas is running older code than the Studio.
 *
 * The Studio's content for these modules was made with a schema the page's
 * build does not have -- the Studio took a code change first (a hot reload,
 * or staged code it evaluated) -- so the page shows its own build's content
 * for them rather than read the Studio's with the wrong schema
 * (`codeChanged`, in `valCanvasProtocol.ts`). Reloading the page gets it the
 * new code. In local development the page usually catches up by itself a
 * moment later, and then this goes away without being asked.
 *
 * Drawn where `CanvasPreviewNotice` is, and only while that one has nothing
 * to say: a page that is not live has a bigger problem to report first.
 */
export function CanvasCodeChangedNotice({
  modules,
  onReload,
}: {
  modules: readonly ModuleFilePath[];
  /** Ask for the page again. */
  onReload: () => void;
}) {
  if (modules.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-window flex flex-col items-center gap-1 p-2">
      <div
        className={cn(
          "pointer-events-auto flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 shadow-sm",
          "text-[0.6875rem]",
          "border-border-warning-primary bg-bg-warning-primary text-fg-warning-primary",
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5" role="status">
          <TriangleAlert size={12} className="shrink-0" aria-hidden />
          <span className="truncate" title={modules.join("\n")}>
            {codeChangedMessage(modules)}
          </span>
        </span>
        <button
          type="button"
          onClick={onReload}
          className={cn(
            "inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 font-medium",
            "bg-bg-brand-primary text-fg-brand-primary",
            "hover:bg-bg-brand-primary-hover",
          )}
        >
          <RefreshCw size={11} aria-hidden />
          Reload
        </button>
      </div>
    </div>
  );
}

/**
 * What the notice says: which file, by its name, or how many. Shared with
 * the on-site overlay's card, so the two say the same thing.
 */
export function codeChangedMessage(modules: readonly ModuleFilePath[]): string {
  const [only] = modules;
  const what =
    modules.length === 1 && only !== undefined
      ? fileNameOf(only)
      : `${modules.length} files`;
  return `The page is running older code than the Studio, so it shows ${what} without your changes.`;
}

function fileNameOf(path: ModuleFilePath): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}
