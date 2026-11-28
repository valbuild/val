import { ReactNode } from "react";
import { ChevronLeft, Ellipsis, Share, SquarePlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../designSystem/dialog";
import { cn } from "../designSystem/cn";

/**
 * How to add the Studio to the home screen in Safari on iPhone and iPad,
 * where no button can do it: Safari has no install prompt for a page to ask
 * for, so the Studio can only show the taps.
 *
 * Shown, not described. Each step is a small drawing of the part of Safari
 * that step is about, with the thing to tap lit in the Studio's accent: an
 * editor holding a phone matches a picture faster than a sentence. They are
 * sketches rather than screenshots, so they stay true as Safari's styling
 * moves; what they show is where to look and which word to look for.
 */
export function InstallAppDialog({
  open,
  onOpenChange,
  iconSrc,
  portalContainer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The icon the app will have: the project's logo, or Val's. */
  iconSrc: string;
  portalContainer?: HTMLElement | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={portalContainer}
        className="w-[calc(100vw-2rem)] max-w-sm gap-0 rounded-xl border-border-float bg-bg-float p-0 md:w-[calc(100vw-2rem)]"
      >
        <div className="px-5 pb-1 pt-5">
          <DialogTitle className="text-sm font-semibold">
            Add to Home Screen
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs text-fg-secondary">
            Three taps in Safari. Val then opens full screen, without the
            address bar.
          </DialogDescription>
        </div>
        <ol className="space-y-4 px-5 py-4">
          <Step
            n={1}
            text={
              <>
                Tap <Strong>Share</Strong>. On newer iPhones it is in the{" "}
                <Strong>•••</Strong> menu.
              </>
            }
          >
            <SafariToolbar />
          </Step>
          <Step
            n={2}
            text={
              <>
                Scroll down and choose <Strong>Add to Home Screen</Strong>.
              </>
            }
          >
            <ShareSheet />
          </Step>
          <Step
            n={3}
            text={
              <>
                Tap <Strong>Add</Strong>.
              </>
            }
          >
            <AddScreen iconSrc={iconSrc} />
          </Step>
        </ol>
      </DialogContent>
    </Dialog>
  );
}

function Step({
  n,
  text,
  children,
}: {
  n: number;
  text: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="space-y-2">
      <div className="flex items-baseline gap-2 text-xs text-fg-secondary">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-bg-float-raised text-[0.6875rem] font-semibold text-fg-primary">
          {n}
        </span>
        <span>{text}</span>
      </div>
      {/* A picture of Safari, so hidden from a screen reader: the sentence
          above says everything it shows. */}
      <div
        aria-hidden
        className="overflow-hidden rounded-lg border border-border-float bg-bg-primary"
      >
        {children}
      </div>
    </li>
  );
}

function Strong({ children }: { children: ReactNode }) {
  return <span className="font-medium text-fg-primary">{children}</span>;
}

/** The thing to tap: lit, so the eye goes there first. */
function Highlight({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center rounded-md border-2 border-bg-brand-primary text-bg-brand-primary",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Safari's bar at the foot of the screen: back, the address, the menu. */
function SafariToolbar() {
  return (
    <div className="flex items-center gap-3 px-3 py-3 text-fg-secondary">
      <ChevronLeft size={16} className="shrink-0" />
      <div className="flex h-7 min-w-0 flex-1 items-center justify-center rounded-full bg-bg-float-raised text-[0.6875rem]">
        <span className="truncate">{location.host}</span>
      </div>
      <Highlight className="h-7 w-7">
        <Share size={15} />
      </Highlight>
      <Highlight className="h-7 w-7">
        <Ellipsis size={15} />
      </Highlight>
    </div>
  );
}

/** The share sheet's list of actions, with the one that matters lit. */
function ShareSheet() {
  const row = "flex items-center justify-between px-3 py-2 text-xs";
  return (
    <div className="divide-y divide-border-float text-fg-secondary">
      <div className={row}>
        <span>Copy</span>
      </div>
      <div className={row}>
        <span>Add to Favourites</span>
      </div>
      <div className="px-2 py-1.5">
        <Highlight className="flex w-full justify-between px-2 py-1.5 text-xs font-medium">
          <span>Add to Home Screen</span>
          <SquarePlus size={14} />
        </Highlight>
      </div>
      <div className={cn(row, "opacity-60")}>
        <span>Add Bookmark</span>
      </div>
    </div>
  );
}

/** The last screen: the icon and name it will get, and Add. */
function AddScreen({ iconSrc }: { iconSrc: string }) {
  return (
    <div className="space-y-2.5 px-3 py-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-fg-secondary">Cancel</span>
        <span className="font-medium text-fg-primary">Add to Home Screen</span>
        <Highlight className="px-1.5 py-0.5 font-semibold">Add</Highlight>
      </div>
      <div className="flex items-center gap-2.5 rounded-md bg-bg-float-raised p-2">
        <img
          src={iconSrc}
          alt=""
          className="h-10 w-10 shrink-0 rounded-[22%] object-cover"
        />
        <div className="min-w-0 text-xs">
          <div className="font-medium text-fg-primary">Val</div>
          <div className="truncate text-fg-secondary-alt">{location.host}</div>
        </div>
      </div>
    </div>
  );
}
