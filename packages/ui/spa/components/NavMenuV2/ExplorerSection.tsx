import { PanelsTopLeft } from "lucide-react";
import { cn } from "../designSystem/cn";
import { ExplorerItem } from "./types";
import { ExplorerItemNode } from "./ExplorerItem";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../designSystem/accordion";
import { ScrollArea } from "../designSystem/scroll-area";

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
  return (
    <AccordionItem value="explorer" className="">
      <AccordionTrigger
        className={cn(
          "flex items-center justify-between w-full h-12 px-4 py-0",
          "text-sm font-medium uppercase tracking-wide text-fg-secondary",
          "hover:bg-bg-secondary hover:no-underline transition-colors",
          "[&[data-state=open]]:bg-bg-secondary",
        )}
      >
        <div className="flex items-center gap-2">
          <PanelsTopLeft size={16} />
          <span>Explorer</span>
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
