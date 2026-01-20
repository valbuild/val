import { ChevronRight, Folder, FileText, AlertCircle } from "lucide-react";
import { useState, useMemo } from "react";
import { cn } from "../designSystem/cn";
import { AnimateHeight } from "../AnimateHeight";
import { ExplorerItem as ExplorerItemType } from "./types";
import { prettifyFilename } from "../../utils/prettifyFilename";

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

  // Check if any children have errors (for collapsed indicator)
  const hasDescendantError = useMemo(() => {
    if (item.hasError) return true;
    const checkChildren = (children: ExplorerItemType[]): boolean => {
      return children.some(
        (child) => child.hasError || checkChildren(child.children),
      );
    };
    return checkChildren(item.children);
  }, [item]);

  const showErrorIndicator = item.hasError || (!isOpen && hasDescendantError);

  const sortedChildren = useMemo(() => {
    // Sort: directories first, then alphabetically
    return [...item.children].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [item.children]);

  const handleClick = () => {
    if (item.isDirectory) {
      setIsOpen(!isOpen);
    } else if (onNavigate) {
      onNavigate(item.fullPath);
    }
  };

  // Skip root node rendering
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

  return (
    <div className="w-full">
      <button
        className={cn(
          "group flex items-center justify-between w-full h-9 pr-2 rounded-md transition-colors text-left",
          "hover:bg-bg-secondary",
          {
            "bg-bg-secondary": isActive,
          },
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={handleClick}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {item.isDirectory ? (
            <ChevronRight
              size={14}
              className={cn(
                "shrink-0 text-fg-secondary transition-transform duration-200",
                {
                  "rotate-90": isOpen,
                  invisible: !hasChildren,
                },
              )}
            />
          ) : (
            <span className="w-3.5" />
          )}

          {item.isDirectory ? (
            <Folder size={14} className="shrink-0 text-fg-secondary" />
          ) : (
            <FileText size={14} className="shrink-0 text-fg-secondary" />
          )}

          <span
            className={cn("truncate text-sm", {
              "font-medium": isActive,
              "font-semibold": isActiveParent,
              "text-fg-primary": !showErrorIndicator,
              "text-fg-error-primary": showErrorIndicator,
            })}
          >
            {prettifyFilename(item.name)}
          </span>
        </div>

        {showErrorIndicator && (
          <AlertCircle size={14} className="shrink-0 text-fg-error-primary" />
        )}
      </button>

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
