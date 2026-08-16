import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "./cn";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & {
    /**
     * Render the tooltip inside this element instead of inline next to the
     * trigger. Needed whenever an ancestor clips overflow: the Val menu, for
     * example, sits inside a transformed wrapper with `overflow-hidden`,
     * which clips the (position: fixed) tooltip away entirely.
     */
    container?: HTMLElement | null;
  }
>(({ className, sideOffset = 4, container, ...props }, ref) => {
  const content = (
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 overflow-hidden rounded-md border bg-bg-primary px-3 py-2 text-sm text-fg-primary shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  );
  // Only portal when we are given somewhere to portal to: the default
  // container is document.body, which is outside the shadow root that carries
  // our styles.
  if (!container) {
    return content;
  }
  return (
    <TooltipPrimitive.Portal container={container}>
      {content}
    </TooltipPrimitive.Portal>
  );
});
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
