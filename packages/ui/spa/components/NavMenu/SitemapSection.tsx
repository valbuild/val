import React, { useMemo, useState } from "react";
import { Globe, Plus } from "lucide-react";
import { ModuleFilePath } from "@valbuild/core";
import { cn } from "../designSystem/cn";
import { SitemapItem } from "./types";
import { SitemapItemNode, routePatternToString } from "./SitemapItem";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../designSystem/accordion";
import { ScrollArea, ScrollBar } from "../designSystem/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../designSystem/popover";
import { AvailableRoute, NewPageForm } from "./NewPageForm";

export type SitemapSectionProps = {
  /** Sitemap data */
  sitemap: SitemapItem;
  /** Current navigation source path */
  currentPath?: string;
  /** Called when a navigable item is clicked */
  onNavigate?: (sourcePath: string) => void;
  /** Called when a new page should be added */
  onAddPage?: (moduleFilePath: string, urlPath: string) => void;
  /** Max height for the content area */
  maxHeight?: string;
  /** Container for portal (for popover) */
  portalContainer?: HTMLElement | null;
};

export function SitemapSection({
  sitemap,
  currentPath,
  onNavigate,
  onAddPage,
  maxHeight = "100%",
  portalContainer,
}: SitemapSectionProps) {
  const [newPageOpen, setNewPageOpen] = useState(false);

  // All available routes the user can create pages under, plus the full set of
  // existing URLs so the form can warn on duplicates regardless of which
  // route is selected.
  const { routes, existingUrls } = useMemo(
    () => collectSitemapRoutes(sitemap),
    [sitemap],
  );

  const handleNewPageSubmit = (
    moduleFilePath: ModuleFilePath,
    urlPath: string,
  ) => {
    if (onAddPage) {
      onAddPage(moduleFilePath, urlPath);
      setNewPageOpen(false);
    }
  };

  return (
    <AccordionItem value="sitemap" className="border-b-0 border-t">
      <div className="relative">
        <AccordionTrigger
          className={cn(
            "flex items-center justify-between w-full h-12 px-4 py-0",
            "text-sm font-medium text-fg-secondary",
            "hover:bg-bg-secondary hover:no-underline transition-colors",
          )}
        >
          <div className="flex items-center gap-2">
            <Globe size={16} />
            <span>Pages</span>
          </div>
        </AccordionTrigger>

        {routes.length > 0 && (
          <div className="absolute right-10 top-1/2 -translate-y-1/2">
            <Popover open={newPageOpen} onOpenChange={setNewPageOpen}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs",
                    "text-fg-secondary hover:text-fg-primary hover:bg-bg-tertiary",
                    "border border-border-primary",
                    "transition-colors",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    setNewPageOpen(true);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Create a new page"
                  aria-label="Create a new page"
                >
                  <Plus size={12} />
                  <span>New page</span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                container={portalContainer}
                align="end"
                side="bottom"
                className="w-auto p-0"
              >
                <NewPageForm
                  routes={routes.map((r) => ({
                    ...r,
                    existingKeys: existingUrls,
                  }))}
                  onSubmit={handleNewPageSubmit}
                  onCancel={() => setNewPageOpen(false)}
                />
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>

      <AccordionContent className="pb-0">
        <ScrollArea className="p-2" style={{ height: maxHeight }}>
          {sitemap.sourcePath ? (
            <SitemapItemNode
              key={sitemap.sourcePath}
              item={sitemap}
              currentPath={currentPath}
              onNavigate={onNavigate}
              onAddPage={onAddPage}
              existingUrls={existingUrls}
              portalContainer={portalContainer}
            />
          ) : (
            <React.Fragment>
              {sitemap.children.map((child, index) => (
                <SitemapItemNode
                  key={child.sourcePath || `${child.urlPath}-${index}`}
                  item={child}
                  currentPath={currentPath}
                  onNavigate={onNavigate}
                  onAddPage={onAddPage}
                  existingUrls={existingUrls}
                  portalContainer={portalContainer}
                />
              ))}
            </React.Fragment>
          )}
          <ScrollBar orientation="vertical" />
        </ScrollArea>
      </AccordionContent>
    </AccordionItem>
  );
}

/**
 * Walk the sitemap collecting every unique route that accepts new pages, plus
 * the flat list of every URL currently in the tree (used for duplicate
 * validation in the top-level "New page" form).
 */
function collectSitemapRoutes(sitemap: SitemapItem): {
  routes: AvailableRoute[];
  existingUrls: string[];
} {
  const routes = new Map<string, AvailableRoute>();
  const urls: string[] = [];

  function walk(item: SitemapItem, parentPath: string) {
    const displayUrl =
      item.name === "/" || item.name === ""
        ? "/"
        : `${parentPath}/${item.name}`;

    if (item.sourcePath || item.children.length === 0) {
      urls.push(displayUrl);
    }

    if (item.canAddChild && item.moduleFilePath && item.routePattern) {
      const patternString = routePatternToString(item.routePattern);
      const key = `${item.moduleFilePath}::${patternString}`;
      if (!routes.has(key)) {
        routes.set(key, {
          moduleFilePath: item.moduleFilePath,
          routePattern: item.routePattern,
          patternString,
          existingKeys: [],
        });
      }
    }

    for (const child of item.children) {
      walk(child, displayUrl === "/" ? "" : displayUrl);
    }
  }

  walk(sitemap, "");

  return { routes: Array.from(routes.values()), existingUrls: urls };
}
