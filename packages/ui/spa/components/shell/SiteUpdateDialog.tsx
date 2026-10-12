import { useState } from "react";
import { Check, Circle, ExternalLink, Loader2, X } from "lucide-react";
import type { DependencyChange } from "@valbuild/shared/internal";
import { Button } from "../designSystem/button";
import { cn } from "../designSystem/cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../designSystem/dialog";
import { copyText } from "../../utils/copyText";
import type {
  SiteUpdateStage,
  SiteUpdateView,
} from "../../publish/useSiteUpdate";
import { summarizeChanges, valReleaseUrl } from "./siteUpdateIndicator";
import type { ShellBreakpoint } from "./types";

/**
 * The site update, as a dialog: what moves, what happens, and the button.
 *
 * Opened from Quick actions (Show updates), so the update is always something
 * a person chose to do, having been told what it does first. The same states
 * as Settings → Updates (`SiteUpdateSection`), which stays the other way in;
 * this one has the room to say more.
 *
 * Presentational: everything arrives as props, so stories and tests render it
 * without a provider. Full height on a phone, with the action pinned to the
 * bottom where a thumb reaches it; a centred dialog everywhere else.
 */
export function SiteUpdateDialog({
  view,
  breakpoint,
  buildsInNewTab,
  pendingChanges,
  portalContainer,
  onUpdate,
  onRetry,
  onReload,
  onOpenBuilderTab,
  onClose,
}: {
  view: SiteUpdateView;
  breakpoint: ShellBreakpoint;
  /** The update runs in a tab of its own (WebKit, every iPhone). */
  buildsInNewTab: boolean;
  /** This person's unpublished changes, which the update leaves alone. */
  pendingChanges: number;
  portalContainer?: HTMLElement | null;
  onUpdate: () => void;
  onRetry: () => void;
  onReload: () => void;
  onOpenBuilderTab: () => void;
  onClose: () => void;
}) {
  const isMobile = breakpoint === "mobile";
  const content = contentOf(view, {
    buildsInNewTab,
    pendingChanges,
    onUpdate,
    onRetry,
    onReload,
    onOpenBuilderTab,
    onClose,
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        container={portalContainer}
        hideClose
        className={cn(
          "p-0 gap-0 border-border-float bg-bg-float text-fg-primary",
          "grid grid-rows-[auto_minmax(0,1fr)_auto]",
          isMobile
            ? // The whole screen, as a sheet: no translate, no gutter.
              "left-0 top-0 translate-x-0 translate-y-0 w-full max-w-none h-[100dvh] rounded-none border-0"
            : "w-full max-w-[min(28rem,calc(100vw-2rem))] max-h-[min(40rem,calc(100vh-4rem))] rounded-lg",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-3 px-5 py-4",
            isMobile && "border-b border-border-float",
          )}
        >
          <DialogTitle className="flex-1 text-sm font-semibold">
            {content.title}
          </DialogTitle>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid place-items-center w-7 h-7 rounded-md text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
          >
            <X size={16} />
          </button>
        </div>
        <div
          className={cn(
            "overflow-y-auto px-5 pb-4 text-xs leading-relaxed flex flex-col gap-4",
            // Below the header's rule on a phone, which the desktop has not.
            isMobile && "pt-4",
          )}
        >
          {content.body}
        </div>
        {content.footer && (
          <div
            className={cn(
              "px-5 py-3 border-t border-border-float",
              isMobile
                ? "pb-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col gap-2"
                : "flex justify-end gap-2",
            )}
          >
            {content.footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type Handlers = {
  buildsInNewTab: boolean;
  pendingChanges: number;
  onUpdate: () => void;
  onRetry: () => void;
  onReload: () => void;
  onOpenBuilderTab: () => void;
  onClose: () => void;
};

type Content = {
  title: string;
  body: React.ReactNode;
  footer: React.ReactNode | null;
};

function contentOf(view: SiteUpdateView, h: Handlers): Content {
  switch (view.status) {
    case "checking":
      return {
        title: "Checking for updates",
        body: (
          <Description>
            Checking for a newer version of the software your site runs on.
          </Description>
        ),
        footer: null,
      };
    case "current":
      return {
        title: "Your site is up to date",
        body: <Description>Your site runs on the newest version.</Description>,
        footer: <Button onClick={h.onClose}>Close</Button>,
      };
    case "unavailable":
      return {
        title: "Updates",
        body: <Description>{view.message}</Description>,
        footer: <Button onClick={h.onClose}>Close</Button>,
      };
    case "check-failed":
      return {
        title: "Could not check for updates",
        body: (
          <>
            <Description>
              Val Build could not be asked whether there is a newer version.
              Nothing has changed on your site.
            </Description>
            <Details text={view.message} />
          </>
        ),
        footer: <Button onClick={h.onRetry}>Try again</Button>,
      };
    case "available":
      return {
        title: "Update your site",
        body: <Offer changes={view.changes} handlers={h} />,
        footer: (
          <>
            <Button variant="outline" onClick={h.onClose}>
              Not now
            </Button>
            <Button onClick={h.onUpdate}>
              Update site
              {h.buildsInNewTab && <ExternalLink size={13} className="ml-1" />}
            </Button>
          </>
        ),
      };
    case "updating":
      return {
        title: "Updating your site",
        body: (
          <>
            <Steps stage={view.stage} />
            <p
              className="text-fg-secondary-alt"
              role="status"
              aria-live="polite"
            >
              {view.step}
              {view.percent === undefined ? "…" : ` · ${view.percent}%`}
            </p>
            <Description>
              {h.buildsInNewTab
                ? "It is building in another tab. Keep that tab open until it is done; it closes itself. "
                : ""}
              You can keep editing. Publishing waits until this is done.
            </Description>
          </>
        ),
        footer: (
          <Button variant="outline" onClick={h.onClose}>
            Close
          </Button>
        ),
      };
    case "blocked":
      return {
        title: "Updating your site",
        body: (
          <Description>
            Your browser blocked the tab that builds the site. Open it to
            continue the update.
          </Description>
        ),
        footer: (
          <Button onClick={h.onOpenBuilderTab}>Open the build tab</Button>
        ),
      };
    case "updated":
      return {
        title: "Your site is updated",
        body: (
          <>
            <Done changes={view.changes} />
            <Description>
              This Studio is still the previous version. Reload to use the new
              one. Nothing you are working on is lost.
            </Description>
          </>
        ),
        footer: <Button onClick={h.onReload}>Reload Studio</Button>,
      };
    case "failed":
      return {
        title: "The update was not published",
        body: (
          <>
            <Description>
              {view.message} Your site has not changed, and still runs the
              version it did.
            </Description>
            {view.details !== "" && <Details text={view.details} />}
          </>
        ),
        footer: (
          <>
            {view.details !== "" && (
              <Button
                variant="outline"
                onClick={() => copyText(`${view.message}\n\n${view.details}`)}
              >
                Copy details
              </Button>
            )}
            <Button onClick={h.onRetry}>Try again</Button>
          </>
        ),
      };
  }
}

function Description({ children }: { children: React.ReactNode }) {
  return (
    <DialogDescription className="text-xs leading-relaxed text-fg-secondary">
      {children}
    </DialogDescription>
  );
}

function Offer({
  changes,
  handlers,
}: {
  changes: DependencyChange[];
  handlers: Handlers;
}) {
  const summary = summarizeChanges(changes);
  const releaseUrl = valReleaseUrl(summary.val?.to ?? null);
  return (
    <>
      <Description>
        A newer version of the software your site runs on is ready. It has been
        built and tested on this platform.
      </Description>
      {changes.length === 0 ? (
        <p className="text-fg-secondary">
          The versions are the same; the platform rebuilt them. Updating moves
          your site onto that build.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {summary.val && (
            <div className="flex items-baseline gap-3">
              <span className="font-medium">Val</span>
              <span className="font-mono text-[0.6875rem] text-fg-secondary">
                {versionMove(summary.val.from, summary.val.to)}
              </span>
              {releaseUrl && (
                <a
                  href={releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-fg-secondary underline underline-offset-2 hover:text-fg-primary"
                >
                  What&apos;s new
                  <ExternalLink size={11} />
                </a>
              )}
            </div>
          )}
          {summary.others.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer select-none text-fg-secondary hover:text-fg-primary">
                {summary.val
                  ? `${summary.others.length} other ${plural(summary.others.length, "package")}`
                  : `${summary.others.length} ${plural(summary.others.length, "package")}`}
              </summary>
              <ChangeList changes={summary.others} />
            </details>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="font-medium">What happens</p>
        <ol className="list-decimal pl-5 text-fg-secondary">
          <li>Your site is rebuilt on the new version.</li>
          <li>It is checked. If the check fails, nothing changes.</li>
          <li>It goes live. This takes a minute or two.</li>
        </ol>
      </div>
      {handlers.pendingChanges > 0 && (
        <p className="rounded-md border border-border-float px-3 py-2 text-fg-secondary">
          You have {handlers.pendingChanges} unpublished{" "}
          {plural(handlers.pendingChanges, "change")}. They are kept, and are
          not published by the update.
        </p>
      )}
      {handlers.buildsInNewTab && (
        <p className="text-fg-secondary-alt">
          A new tab opens to build the site, and closes when it is done.
        </p>
      )}
    </>
  );
}

const STEPS: { stage: SiteUpdateStage; label: string }[] = [
  { stage: "rebuilding", label: "Rebuilding on the new version" },
  { stage: "checking", label: "Checking the updated site" },
  { stage: "going-live", label: "Going live" },
];

function Steps({ stage }: { stage: SiteUpdateStage | undefined }) {
  // Before the deploy reports a phase, the first step is the one under way.
  const current = STEPS.findIndex(
    (step) => step.stage === (stage ?? "rebuilding"),
  );
  return (
    <ol className="flex flex-col gap-2">
      {STEPS.map((step, index) => (
        <li
          key={step.stage}
          className={cn(
            "flex items-center gap-2",
            index > current && "text-fg-secondary-alt",
          )}
        >
          {index < current ? (
            <Check size={14} className="text-fg-brand-primary" />
          ) : index === current ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Circle size={14} />
          )}
          {step.label}
        </li>
      ))}
    </ol>
  );
}

function Done({ changes }: { changes: DependencyChange[] }) {
  const summary = summarizeChanges(changes);
  const others = summary.others.length;
  const what = summary.val?.to
    ? `Val ${summary.val.to}${others > 0 ? `, with ${others} other ${plural(others, "package")}` : ""}`
    : others > 0
      ? `${others} updated ${plural(others, "package")}`
      : "the new build";
  return (
    <p className="flex items-center gap-2">
      <Check size={14} className="text-fg-brand-primary" />
      Live on {what}.
    </p>
  );
}

function ChangeList({ changes }: { changes: DependencyChange[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {changes.map((change) => (
        <li
          key={`${change.section}:${change.name}`}
          className="flex items-baseline justify-between gap-3"
        >
          <span className="font-mono text-[0.6875rem] truncate">
            {change.name}
          </span>
          <span className="shrink-0 font-mono text-[0.6875rem] text-fg-secondary-alt">
            {versionMove(change.from, change.to)}
            {change.section === "devDependencies" && (
              <span className="ml-2 font-sans">build only</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Details({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="self-start text-fg-secondary hover:text-fg-primary"
      >
        {open ? "Hide details" : "Details"}
      </button>
      {open && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border-float p-2 font-mono text-[0.6875rem] text-fg-secondary-alt">
          {text}
        </pre>
      )}
    </div>
  );
}

function versionMove(from: string | null, to: string | null): string {
  return to === null ? `${from ?? ""} → removed` : `${from ?? "new"} → ${to}`;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
