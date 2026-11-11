import { CircleHelp } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../designSystem/popover";
import { useValPortal } from "../ValPortalProvider";

/**
 * The Sketchpad's ?: what it is and how it is used, for someone meeting it
 * for the first time. Short, and in the order a sketch is made: write it,
 * shape it, look at it, build it.
 */
export function SketchpadHelp() {
  const portal = useValPortal();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="How the Sketchpad works"
          title="How the Sketchpad works"
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
        >
          <CircleHelp className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        container={portal}
        align="end"
        // Clear of the screen's edges on a phone.
        collisionPadding={12}
        className="w-80 max-w-[calc(100vw-24px)] p-0 text-xs leading-relaxed"
      >
        <div className="border-b border-border-primary px-3 py-2 font-medium text-fg-primary">
          How the Sketchpad works
        </div>
        <div className="flex flex-col gap-2 px-3 py-2.5 text-fg-secondary">
          <p>
            A rough draft of how pages should be. Write headings and text, and
            sketch everything else as boxes. Nothing on the site changes while
            you sketch.
          </p>
          <ul className="flex list-disc flex-col gap-1.5 pl-4">
            <li>
              <span className="font-medium text-fg-primary">Pages.</span> A
              route divider, such as <code>/about</code>, starts the part of the
              sketch for that page. Press it to see the page in the preview.
            </li>
            <li>
              <span className="font-medium text-fg-primary">Boxes.</span> A box
              is a section, like a hero or a testimonial. Its kind is one of the
              sections your pages already have. Any other kind is marked{" "}
              <em>New type: needs code</em>, since building it needs a developer
              or the assistant in code mode.
            </li>
            <li>
              <span className="font-medium text-fg-primary">Images.</span> Drop
              an image into a box, or press the image button on the box to pick
              one the site already has.
            </li>
            <li>
              <span className="font-medium text-fg-primary">Moving.</span> Drag
              a block by the dots beside it.
            </li>
            <li>
              <span className="font-medium text-fg-primary">Build.</span> The
              assistant reads the sketch and changes the pages to match it. Its
              changes are drafts, so you review them before anything is
              published.
            </li>
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
