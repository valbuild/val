import { Images, Paperclip } from "lucide-react";
import { useMemo } from "react";
import { cn } from "../designSystem/cn";
import { MediaModule } from "./types";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../designSystem/accordion";
import { ScrollArea } from "../designSystem/scroll-area";
import { ErrorBadge } from "./ErrorBadge";

export type MediaSectionProps = {
  /** The `s.images()` / `s.files()` gallery modules. */
  media: MediaModule[];
  /** Current navigation source path. */
  currentPath?: string;
  /** Called with the gallery module's path when a directory is clicked. */
  onNavigate?: (moduleFilePath: string) => void;
  /** Max height for the content area. */
  maxHeight?: string;
};

/**
 * Media: the project's `s.images()` and `s.files()` galleries.
 *
 * A gallery is a record keyed by file path, so the unit an editor thinks in is
 * the DIRECTORY it is constrained to - not the `.val.ts` that declares it. Rows
 * are therefore labelled by directory, and selecting one opens the module, which
 * renders the gallery itself.
 *
 * These modules are deliberately absent from Explorer: two entry points for one
 * module is confusing, and the Explorer one presents a record of file paths
 * rather than a gallery.
 */
export function MediaSection({
  media,
  currentPath,
  onNavigate,
  maxHeight = "100%",
}: MediaSectionProps) {
  const sectionErrorCount = useMemo(
    () =>
      media.reduce((count, entry) => count + (entry.errors?.ownCount ?? 0), 0),
    [media],
  );

  return (
    <AccordionItem value="media" className="border-b-0">
      <AccordionTrigger
        className={cn(
          "flex items-center justify-between w-full h-12 px-4 py-0",
          "text-sm font-medium text-fg-secondary",
          "hover:bg-bg-secondary hover:no-underline transition-colors",
        )}
      >
        <div className="flex items-center gap-2">
          <Images size={16} />
          <span>Media</span>
          {sectionErrorCount > 0 && (
            <ErrorBadge
              count={sectionErrorCount}
              ownCount={0}
              size="sm"
              aggregateLocation="in this section"
            />
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-0">
        <ScrollArea className="p-2" style={{ height: maxHeight }}>
          <div className="flex flex-col">
            {media.map((entry) => {
              const isActive = currentPath?.startsWith(entry.moduleFilePath);
              const Icon = entry.mediaType === "images" ? Images : Paperclip;
              return (
                <button
                  key={entry.moduleFilePath}
                  className={cn(
                    "flex items-center gap-2 w-full px-2 py-1.5 rounded text-left",
                    "text-sm text-fg-secondary",
                    "hover:bg-bg-secondary transition-colors",
                    { "bg-bg-secondary text-fg-primary": isActive },
                  )}
                  onClick={() => onNavigate?.(entry.moduleFilePath)}
                  title={entry.moduleFilePath}
                >
                  <Icon size={14} className="shrink-0" />
                  <span className="truncate flex-1">{entry.directory}</span>
                  {entry.errors && entry.errors.ownCount > 0 && (
                    <ErrorBadge
                      count={entry.errors.ownCount}
                      ownCount={entry.errors.ownCount}
                      firstMessage={entry.errors.firstMessage}
                      size="sm"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </AccordionContent>
    </AccordionItem>
  );
}
