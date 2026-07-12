import { PanelsTopLeft } from "lucide-react";
import { useMemo } from "react";
import { cn } from "../designSystem/cn";
import { ExplorerItem } from "./types";
import { ExplorerItemNode } from "./ExplorerItem";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../designSystem/accordion";
import { ScrollArea } from "../designSystem/scroll-area";
import { ErrorBadge } from "./ErrorBadge";
import { totalExplorerErrorCount } from "./errorAggregation";

export type ExplorerSectionProps = {
  /** Explorer data */
  explorer: ExplorerItem;
  /** Current navigation source path */
  currentPath?: string;
  /** Called when a file is clicked */
  onNavigate?: (fullPath: string) => void;
  /** Max height for the content area */
  maxHeight?: string;
};

export function ExplorerSection({
  explorer,
  currentPath,
  onNavigate,
  maxHeight = "100%",
}: ExplorerSectionProps) {
  const sectionErrorCount = useMemo(
    () => totalExplorerErrorCount(explorer),
    [explorer],
  );

  return (
    <AccordionItem value="explorer" className="border-b-0">
      <AccordionTrigger
        className={cn(
          "flex items-center justify-between w-full h-12 px-4 py-0",
          "text-sm font-medium text-fg-secondary",
          "hover:bg-bg-secondary hover:no-underline transition-colors",
        )}
      >
        <div className="flex items-center gap-2">
          <PanelsTopLeft size={16} />
          <span>Explorer</span>
          {sectionErrorCount > 0 && (
            <ErrorBadge count={sectionErrorCount} ownCount={0} size="sm" />
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-0">
        <ScrollArea className="p-2" style={{ height: maxHeight }}>
          <ExplorerItemNode
            item={explorer}
            currentPath={currentPath}
            onNavigate={onNavigate}
          />
        </ScrollArea>
      </AccordionContent>
    </AccordionItem>
  );
}
