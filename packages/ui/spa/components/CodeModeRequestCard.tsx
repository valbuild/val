import { Check, CodeXml, XCircle } from "lucide-react";
import { cn } from "./designSystem/cn";
import { Spinner } from "./designSystem/spinner";

/**
 * The assistant asking for code mode (`request_code_mode`), in the chat.
 *
 * The assistant always has the code tools in a hosted Studio, but with code
 * mode off they refuse: code mode is the person's say-so that this chat may
 * change the code, and the switch is in the top bar (`CodeModeButton`) where
 * they can see it. When a request needs code, the assistant asks here rather
 * than describing where the switch is -- the button IS the switch. Like a
 * question card the turn waits on it, so it is never folded away with the
 * other tool calls.
 *
 * On the site, where the project lets it, the button turns on the site's
 * own code mode (valbuild/home `docs/proposals.md`, "Code mode on the
 * site"). Where it does not, code is changed in a proposal, so the button
 * chooses one instead, and the proposal opens with code mode on.
 */
export type CodeModeRequest = {
  /** What the assistant wants to change, in its own words. */
  reason: string;
  /**
   * Where the Studio is: code mode is turned on in a proposal, or -- where
   * the project lets it (`siteCode`) -- on the site itself.
   */
  where:
    | { kind: "proposal"; displayName: string }
    | { kind: "site"; siteCode?: boolean };
  state: "asking" | "turning-on" | "on" | "declined";
};

export function CodeModeRequestCard({
  request,
  onEnable,
  onDecline,
}: {
  request: CodeModeRequest;
  /**
   * In a proposal: turn code mode on. On the site: choose a proposal to open
   * in code mode (the top bar's menu).
   */
  onEnable: () => void;
  onDecline: () => void;
}) {
  if (request.state === "on") {
    return (
      <div className="flex items-center gap-1.5 py-0.5 text-xs text-fg-secondary">
        <Check className="h-3 w-3 text-fg-proposal" />
        <CodeXml className="h-3 w-3" />
        <span>Code mode turned on</span>
      </div>
    );
  }
  if (request.state === "declined") {
    return (
      <div className="flex items-center gap-1.5 py-0.5 text-xs text-fg-secondary">
        <XCircle className="h-3 w-3" />
        <CodeXml className="h-3 w-3" />
        <span>Code mode not turned on</span>
      </div>
    );
  }
  const turningOn = request.state === "turning-on";
  const inProposal = request.where.kind === "proposal" ? request.where : null;
  const onSiteCode =
    request.where.kind === "site" && request.where.siteCode === true;
  return (
    <div
      role="group"
      aria-label="The assistant asks for code mode"
      className="rounded-lg border border-border-proposal bg-bg-proposal-soft p-3"
    >
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-bg-proposal text-fg-on-proposal">
          <CodeXml className="h-3.5 w-3.5" />
        </span>
        <span className="text-sm font-medium text-fg-primary">
          {inProposal !== null || onSiteCode
            ? "Turn on code mode?"
            : "This needs a code change"}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-fg-secondary">
        {request.reason}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-fg-secondary">
        {inProposal !== null ? (
          <>
            The assistant can then change the code of{" "}
            <span className="font-medium text-fg-primary">
              {inProposal.displayName}
            </span>
            , and you see it in the preview. The site changes only when the
            proposal is published.
          </>
        ) : onSiteCode ? (
          <>
            The assistant can then change the site&rsquo;s code, and you see it
            in the preview. Everything waiting to be published goes with it, and
            the site changes when you publish.
          </>
        ) : (
          <>
            Code is never changed on the site directly. Choose a proposal, and
            it opens with code mode on.
          </>
        )}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDecline}
          disabled={turningOn}
          className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary disabled:text-fg-disabled"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={onEnable}
          disabled={turningOn}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
            "bg-bg-proposal text-fg-on-proposal hover:bg-bg-proposal-hover",
            "disabled:cursor-progress disabled:opacity-80",
          )}
        >
          {turningOn ? (
            <Spinner size={14} />
          ) : (
            <CodeXml className="h-3.5 w-3.5" />
          )}
          {turningOn
            ? "Turning on…"
            : inProposal !== null || onSiteCode
              ? "Turn on code mode"
              : "Choose a proposal…"}
        </button>
      </div>
    </div>
  );
}
