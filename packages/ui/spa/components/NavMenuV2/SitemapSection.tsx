import { Globe } from "lucide-react";
import { cn } from "../designSystem/cn";
import { SitemapItem } from "./types";
import { SitemapItemNode } from "./SitemapItem";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../designSystem/accordion";
import React from "react";
import { ScrollArea, ScrollBar } from "../designSystem/scroll-area";

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
  return (
    <AccordionItem value="sitemap" className="border-b-0 border-t">
      <AccordionTrigger
        className={cn(
          "flex items-center justify-between w-full h-12 px-4 py-0",
          "text-sm font-medium uppercase tracking-wide text-fg-secondary",
          "hover:bg-bg-secondary hover:no-underline transition-colors",
          "[&[data-state=open]]:bg-bg-secondary"
        )}
      >
        <div className="flex items-center gap-2">
          <Globe size={16} />
          <span>Pages</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-0">
        <ScrollArea className="p-2" style={{ height: maxHeight }}>
          {sitemap.sourcePath ? (
            <SitemapItemNode
              key={sitemap.sourcePath}
              item={sitemap}
              currentPath={currentPath}
              onNavigate={onNavigate}
              onAddPage={onAddPage}
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
