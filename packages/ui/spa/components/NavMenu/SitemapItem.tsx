import { ChevronRight, Plus } from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { ModuleFilePath } from "@valbuild/core";
import { RoutePattern } from "@valbuild/shared/internal";
import { cn } from "../designSystem/cn";
import { AnimateHeight } from "../AnimateHeight";
import { SitemapItem as SitemapItemType } from "./types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../designSystem/popover";
import { AvailableRoute, NewPageForm } from "./NewPageForm";
import { ErrorBadge } from "./ErrorBadge";
import { totalSitemapErrorCount } from "./errorAggregation";

export type SitemapItemProps = {
  item: SitemapItemType;
  /** Current navigation source path */
  currentPath?: string;
  /** Called when a navigable item is clicked */
  onNavigate?: (sourcePath: string) => void;
  /** Called when a new page should be added */
  onAddPage?: (moduleFilePath: string, urlPath: string) => void;
  /** Existing URL paths (for duplicate validation in row-level add). */
  existingUrls?: string[];
  /** Nesting depth, used to indent the row */
  depth?: number;
  /** Accumulated URL path from ancestors (e.g. "/blogs"). */
  /** Container for portal (for popover) */
  portalContainer?: HTMLElement | null;
};

export function SitemapItemNode({
  item,
  currentPath = "",
  onNavigate,
  onAddPage,
  existingUrls,
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

  // `item.urlPath` is the resolved URL the data layer computed from the route
  // pattern, and is what navigation and key creation use. Rebuilding it here as
  // `parentPath + "/" + item.name` duplicated that computation and drifts the
  // moment the upstream one normalizes or encodes a segment - the row would then
  // display a path that is not the one being created under.
  const displayUrl = useMemo(() => {
    if (item.name === "/" || item.name === "") return "/";
    return item.urlPath;
  }, [item.name, item.urlPath]);

  // The prefix rendered in muted text so this row's own segment stands out.
  // Trimmed off the END of urlPath rather than re-joined from the parent, so a
  // catch-all key ("guides/intro") stays one emphasised segment instead of
  // being split at its internal slash.
  const prefix = useMemo(() => {
    if (displayUrl === "/" || !item.name) return "";
    if (displayUrl.endsWith(item.name)) {
      return displayUrl.slice(0, displayUrl.length - item.name.length);
    }
    return "";
  }, [displayUrl, item.name]);

  const ownSegment = useMemo(() => {
    if (displayUrl === "/") return "/";
    return item.name;
  }, [displayUrl, item.name]);

  // The depth of this row in URL terms (root = 0, /blogs = 1, /blogs/x = 2).
  // Used to find the next dynamic segment a user could create under this row.
  const urlDepth = useMemo(() => {
    if (displayUrl === "/") return 0;
    return displayUrl.split("/").filter(Boolean).length;
  }, [displayUrl]);

  const nextDynamicSegment = useMemo(() => {
    if (!item.canAddChild || !item.routePattern) return null;
    const part = item.routePattern[urlDepth];
    if (!part) return null;
    if (part.type === "string-param" || part.type === "array-param") {
      return part;
    }
    return null;
  }, [item.canAddChild, item.routePattern, urlDepth]);

  // Scroll the active row into view, slightly delayed so accordion/expand
  // animations have time to settle.
  useEffect(() => {
    if (isExactActive && itemRef.current) {
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
    if (item.sourcePath && onNavigate) {
      onNavigate(item.sourcePath);
    } else if (hasChildren) {
      setIsOpen((prev) => !prev);
    }
  };

  const handleAddSubmit = (moduleFilePath: ModuleFilePath, urlPath: string) => {
    if (onAddPage) {
      onAddPage(moduleFilePath, urlPath);
      setAddPopoverOpen(false);
    }
  };

  // Errors for this row + everything beneath it. The data layer attaches
  // `errors.ownCount`; the descendant sum is recomputed each render but cached
  // by item identity (stable across renders from `useNavMenuData`).
  const ownErrorCount = item.errors?.ownCount ?? 0;
  const totalErrorCount = useMemo(() => totalSitemapErrorCount(item), [item]);

  const rowRoute: AvailableRoute | null = useMemo(() => {
    if (!item.canAddChild || !item.moduleFilePath || !item.routePattern) {
      return null;
    }
    return {
      moduleFilePath: item.moduleFilePath,
      routePattern: item.routePattern,
      patternString: routePatternToString(item.routePattern),
      existingKeys: existingUrls ?? item.existingKeys ?? [],
      keyDescription: item.keyDescription,
    };
  }, [
    item.canAddChild,
    item.moduleFilePath,
    item.routePattern,
    item.existingKeys,
    item.keyDescription,
    existingUrls,
  ]);

  // Indent the row using a fixed left padding scaled by depth.
  const indent = depth * 12 + 8;

  return (
    <div className="w-full">
      <div
        ref={itemRef}
        className={cn(
          "group relative flex items-center justify-between w-full h-8 pr-1.5 rounded-md transition-colors",
          "hover:bg-bg-secondary",
          {
            "bg-bg-secondary": isActive,
          },
        )}
        style={{ paddingLeft: `${indent}px` }}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        {hasChildren ? (
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
            {prefix && <span className="text-fg-secondary">{prefix}</span>}
            <span
              className={cn({
                "text-fg-primary": isNavigable || hasChildren,
                "text-fg-secondary": !isNavigable && !hasChildren,
              })}
            >
              {ownSegment}
            </span>
          </span>

          {nextDynamicSegment && (
            <DynamicSegmentPill part={nextDynamicSegment} />
          )}
        </button>

        {totalErrorCount > 0 && (
          <ErrorBadge
            count={totalErrorCount}
            ownCount={ownErrorCount}
            firstMessage={item.errors?.firstMessage}
          />
        )}

        {/* `onAddPage` is what actually creates the page, so without it the
            form would submit into nothing and leave the popover open. */}
        {onAddPage && rowRoute && (showActions || addPopoverOpen) && (
          <Popover open={addPopoverOpen} onOpenChange={setAddPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                className="shrink-0 p-1 rounded hover:bg-bg-tertiary text-fg-secondary hover:text-fg-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  setAddPopoverOpen(true);
                }}
                title="Add page under this route"
                aria-label="Add page under this route"
              >
                <Plus size={12} />
              </button>
            </PopoverTrigger>
            <PopoverContent
              container={portalContainer}
              side="right"
              align="start"
              className="w-auto p-0"
            >
              <NewPageForm
                routes={[rowRoute]}
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
            {sortedChildren.map((child, index) => (
              <SitemapItemNode
                key={child.sourcePath || `${child.urlPath}-${index}`}
                item={child}
                currentPath={currentPath}
                onNavigate={onNavigate}
                onAddPage={onAddPage}
                existingUrls={existingUrls}
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

function DynamicSegmentPill({
  part,
}: {
  part: Extract<
    RoutePattern,
    { type: "string-param" } | { type: "array-param" }
  >;
}) {
  const label =
    part.type === "array-param" ? `...${part.paramName}` : part.paramName;
  return (
    <span
      className={cn(
        "shrink-0 inline-flex items-center px-1.5 rounded text-[10px] leading-[1.4]",
        "bg-bg-brand-secondary text-fg-brand-secondary",
      )}
      title={
        part.type === "array-param"
          ? "Catch-all route segment"
          : "Dynamic route segment"
      }
    >
      [{label}]
    </span>
  );
}

/**
 * Stringify a parsed route pattern back into a human-readable form like
 * "/blogs/[blog]". Used as a display label and as part of the route's unique
 * key.
 */
export function routePatternToString(pattern: RoutePattern[]): string {
  if (pattern.length === 0) return "/";
  return (
    "/" +
    pattern
      .map((part) => {
        if (part.type === "literal") return part.name;
        // The OPTIONAL marker is part of the pattern's identity, not decoration:
        // `[category]` and `[[category]]` are different routes, and dropping the
        // brackets made them stringify identically - so two routers collided on
        // one key in `collectSitemapRoutes` and only one was offered.
        const inner =
          part.type === "string-param"
            ? part.paramName
            : `...${part.paramName}`;
        return part.optional ? `[[${inner}]]` : `[${inner}]`;
      })
      .join("/")
  );
}
