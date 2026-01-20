import { ChevronRight, FileText, Folder, Plus } from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { cn } from "../designSystem/cn";
import { AnimateHeight } from "../AnimateHeight";
import { SitemapItem as SitemapItemType } from "./types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../designSystem/popover";
import { RoutePattern } from "@valbuild/shared/internal";
import { Button } from "../designSystem/button";

export type SitemapItemProps = {
  item: SitemapItemType;
  /** Current navigation source path */
  currentPath?: string;
  /** Called when a navigable item is clicked */
  onNavigate?: (sourcePath: string) => void;
  /** Called when a new page should be added */
  onAddPage?: (moduleFilePath: string, urlPath: string) => void;
  /** Nesting depth for indentation */
  depth?: number;
  /** Container for portal (for popover) */
  portalContainer?: HTMLElement | null;
};

export function SitemapItemNode({
  item,
  currentPath = "",
  onNavigate,
  onAddPage,
  depth = 0,
  portalContainer,
}: SitemapItemProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [showActions, setShowActions] = useState(false);
  const [addPopoverOpen, setAddPopoverOpen] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);

  const hasChildren = item.children.length > 0;
  const isNavigable = !!item.sourcePath;
  const isActive = item.sourcePath && currentPath.startsWith(item.sourcePath);
  const isExactActive = item.sourcePath === currentPath;
  const isFolder = hasChildren && !isNavigable;

  // Scroll into view when this item becomes the exact active item
  useEffect(() => {
    if (isExactActive && itemRef.current) {
      // Use a small delay to ensure the DOM is fully settled after navigation
      // and any accordion/animation changes have completed
      const timeoutId = setTimeout(() => {
        itemRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
      }, 200);
      return () => clearTimeout(timeoutId);
    }
  }, [isExactActive, currentPath]);

  const sortedChildren = useMemo(() => {
    return [...item.children].sort((a, b) => a.name.localeCompare(b.name));
  }, [item.children]);

  const handleClick = () => {
    if (isNavigable && item.sourcePath && onNavigate) {
      onNavigate(item.sourcePath);
    } else if (hasChildren) {
      setIsOpen(!isOpen);
    }
  };

  const handleAddSubmit = (urlPath: string) => {
    if (item.moduleFilePath && onAddPage) {
      onAddPage(item.moduleFilePath, urlPath);
      setAddPopoverOpen(false);
    }
  };

  return (
    <div className="w-full">
      <div
        ref={itemRef}
        className={cn(
          "group relative flex items-center justify-between w-full h-9 pr-2 rounded-md transition-colors",
          "hover:bg-bg-secondary",
          {
            "bg-bg-secondary": isActive,
          },
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        <button
          className="flex items-center gap-1.5 flex-1 min-w-0 py-1.5 text-sm text-left"
          onClick={handleClick}
        >
          {hasChildren && (
            <ChevronRight
              size={14}
              className={cn(
                "shrink-0 text-fg-secondary transition-transform duration-200",
                {
                  "rotate-90": isOpen,
                },
              )}
            />
          )}
          {!hasChildren && <span className="w-3.5" />}

          {isFolder ? (
            <Folder size={14} className="shrink-0 text-fg-secondary" />
          ) : (
            <FileText size={14} className="shrink-0 text-fg-secondary" />
          )}

          <span
            className={cn("truncate", {
              "font-medium": isActive,
              "text-fg-primary": isNavigable || isFolder,
              "text-fg-secondary": !isNavigable && !isFolder,
            })}
          >
            /{item.name !== "/" ? item.name : ""}
          </span>
        </button>

        {item.canAddChild &&
          item.routePattern &&
          (showActions || addPopoverOpen) && (
            <Popover open={addPopoverOpen} onOpenChange={setAddPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  className="shrink-0 p-1 rounded hover:bg-bg-tertiary text-fg-secondary hover:text-fg-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAddPopoverOpen(true);
                  }}
                  title="Add page"
                >
                  <Plus size={14} />
                </button>
              </PopoverTrigger>
              <PopoverContent
                container={portalContainer}
                side="right"
                align="start"
                className="w-auto"
              >
                <AddRouteForm
                  routePattern={item.routePattern}
                  existingKeys={item.existingKeys || []}
                  onSubmit={handleAddSubmit}
                  onCancel={() => setAddPopoverOpen(false)}
                />
              </PopoverContent>
            </Popover>
          )}
      </div>

      {hasChildren && (
        <AnimateHeight isOpen={isOpen}>
          <div>
            {sortedChildren.map((child) => (
              <SitemapItemNode
                key={child.urlPath}
                item={child}
                currentPath={currentPath}
                onNavigate={onNavigate}
                onAddPage={onAddPage}
                depth={depth + 1}
                portalContainer={portalContainer}
              />
            ))}
          </div>
        </AnimateHeight>
      )}
    </div>
  );
}

/**
 * Simplified route form for adding new pages.
 * This can work standalone without providers for Storybook.
 */
function AddRouteForm({
  routePattern,
  existingKeys,
  onSubmit,
  onCancel,
}: {
  routePattern: RoutePattern[];
  existingKeys: string[];
  onSubmit: (urlPath: string) => void;
  onCancel: () => void;
}) {
  const [params, setParams] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const fullPath = useMemo(() => {
    return (
      "/" +
      routePattern
        .map((part) => {
          if (part.type === "string-param" || part.type === "array-param") {
            return params[part.paramName] || "";
          }
          return part.name;
        })
        .join("/")
    );
  }, [routePattern, params]);

  const isComplete = useMemo(() => {
    return routePattern.every((part) => {
      if (part.type === "string-param" || part.type === "array-param") {
        return !!params[part.paramName] && !errors[part.paramName];
      }
      return true;
    });
  }, [routePattern, params, errors]);

  const alreadyExists = existingKeys.includes(fullPath);
  const disabled = !isComplete || alreadyExists;

  return (
    <form
      className="p-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(fullPath);
      }}
    >
      <div className="text-sm font-medium text-fg-primary mb-2">
        Add new page
      </div>
      <div className="flex items-center text-sm">
        {routePattern.map((part, i) => (
          <span key={i} className="truncate">
            {part.type === "string-param" || part.type === "array-param" ? (
              <span className="flex items-center">
                <span className="text-fg-secondary">/</span>
                <span className="flex flex-col">
                  <input
                    autoFocus={
                      i === routePattern.findIndex((p) => p.type !== "literal")
                    }
                    className={cn(
                      "p-1 bg-bg-secondary border border-border-primary rounded max-w-[12ch] text-fg-primary",
                      "focus:outline-none focus:ring-1 focus:ring-border-focus",
                      {
                        "border-fg-error": errors[part.paramName],
                      },
                    )}
                    placeholder={part.paramName}
                    value={params[part.paramName] || ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      setParams({ ...params, [part.paramName]: value });

                      // Validate: no special characters
                      const compareValue =
                        part.type === "string-param"
                          ? value
                          : value.replace(/\//g, "");
                      if (
                        value &&
                        encodeURIComponent(compareValue) !== compareValue
                      ) {
                        setErrors({
                          ...errors,
                          [part.paramName]: "Invalid characters",
                        });
                      } else {
                        setErrors({ ...errors, [part.paramName]: undefined });
                      }
                    }}
                  />
                  {errors[part.paramName] && (
                    <span className="text-xs text-fg-error mt-0.5">
                      {errors[part.paramName]}
                    </span>
                  )}
                </span>
              </span>
            ) : (
              <span className="text-fg-secondary">/{part.name}</span>
            )}
          </span>
        ))}
      </div>
      {alreadyExists && (
        <p className="text-xs text-fg-error">
          A page with this path already exists
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <Button size="sm" disabled={disabled} type="submit">
          Create
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
