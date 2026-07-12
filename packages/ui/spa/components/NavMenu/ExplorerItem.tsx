import { ChevronRight } from "lucide-react";
import { useState, useMemo } from "react";
import { cn } from "../designSystem/cn";
import { AnimateHeight } from "../AnimateHeight";
import { ExplorerItem as ExplorerItemType } from "./types";
import { ErrorBadge } from "./ErrorBadge";
import { totalExplorerErrorCount } from "./errorAggregation";

export type ExplorerItemProps = {
  item: ExplorerItemType;
  /** Current navigation source path */
  currentPath?: string;
  /** Called when a file is clicked */
  onNavigate?: (fullPath: string) => void;
  /** Nesting depth for indentation */
  depth?: number;
};

export function ExplorerItemNode({
  item,
  currentPath = "",
  onNavigate,
  depth = 0,
}: ExplorerItemProps) {
  const [isOpen, setIsOpen] = useState(true);

  const hasChildren = item.children.length > 0;
  const isActive = currentPath.startsWith(item.fullPath) && !item.isDirectory;
  const isActiveParent =
    currentPath.startsWith(item.fullPath) && item.isDirectory;
  const isExactActive = currentPath === item.fullPath;

  // Errors that resolve directly to this file (zero for directories), plus
  // the recursive total used by the count badge.
  const ownErrorCount = item.errors?.ownCount ?? (item.hasError ? 1 : 0);
  const totalErrorCount = useMemo(() => totalExplorerErrorCount(item), [item]);
  const hasOwnError = ownErrorCount > 0;

  // Sort: directories first, then alphabetically.
  const sortedChildren = useMemo(() => {
    return [...item.children].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [item.children]);

  // Strip val module suffixes — `.val.ts`/`.val.js` are noise on every row.
  // Other extensions are kept so users can still tell different file types apart.
  const displayName = useMemo(() => stripValExtension(item.name), [item.name]);

  // Skip the synthetic "/" root row — just render its children at depth 0.
  if (item.name === "/" && depth === 0) {
    return (
      <>
        {sortedChildren.map((child) => (
          <ExplorerItemNode
            key={child.fullPath}
            item={child}
            currentPath={currentPath}
            onNavigate={onNavigate}
            depth={0}
          />
        ))}
      </>
    );
  }

  const handleClick = () => {
    if (item.isDirectory) {
      setIsOpen((prev) => !prev);
    } else if (onNavigate) {
      onNavigate(item.fullPath);
    }
  };

  const indent = depth * 12 + 8;

  return (
    <div className="w-full">
      <div
        className={cn(
          "group relative flex items-center justify-between w-full h-8 pr-1.5 rounded-md transition-colors",
          "hover:bg-bg-secondary",
          {
            "bg-bg-secondary": isActive || isActiveParent,
          },
        )}
        style={{ paddingLeft: `${indent}px` }}
      >
        {item.isDirectory && hasChildren ? (
          <button
            onClick={() => setIsOpen((prev) => !prev)}
            className="shrink-0 mr-1 text-fg-secondary"
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            <ChevronRight
              size={12}
              className={cn("transition-transform duration-200", {
                "rotate-90": isOpen,
              })}
            />
          </button>
        ) : (
          <span className="shrink-0 w-3 mr-1" />
        )}

        <button
          className="flex-1 min-w-0 flex items-center gap-1 py-1 text-left font-mono text-xs leading-none"
          onClick={handleClick}
        >
          <span
            className={cn("truncate", {
              "font-medium": isExactActive,
            })}
          >
            <span
              className={cn({
                // Direct errors on a file tint its name red. Aggregated counts
                // on a parent folder use only the badge — the folder name
                // stays neutral.
                "text-fg-error-primary": hasOwnError,
                "text-fg-primary": !hasOwnError && !item.isDirectory,
                "text-fg-secondary": !hasOwnError && item.isDirectory,
              })}
            >
              {displayName}
              {item.isDirectory && <span className="text-fg-secondary">/</span>}
            </span>
          </span>
        </button>

        {totalErrorCount > 0 && (
          <ErrorBadge
            count={totalErrorCount}
            ownCount={ownErrorCount}
            firstMessage={item.errors?.firstMessage}
          />
        )}
      </div>

      {hasChildren && (
        <AnimateHeight isOpen={isOpen}>
          <div>
            {sortedChildren.map((child) => (
              <ExplorerItemNode
                key={child.fullPath}
                item={child}
                currentPath={currentPath}
                onNavigate={onNavigate}
                depth={depth + 1}
              />
            ))}
          </div>
        </AnimateHeight>
      )}
    </div>
  );
}

/**
 * Strip the val module extensions (`.val.ts`, `.val.js`) so the display reads
 * as a clean module name. Other extensions are kept so users can still
 * distinguish file types.
 */
function stripValExtension(name: string): string {
  if (name.endsWith(".val.ts")) return name.slice(0, -".val.ts".length);
  if (name.endsWith(".val.js")) return name.slice(0, -".val.js".length);
  return name;
}
