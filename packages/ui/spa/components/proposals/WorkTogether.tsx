import { AlertTriangle, GitBranch, Users } from "lucide-react";
import { useId, useState, type ComponentProps } from "react";
import { Button } from "../designSystem/button";
import { Checkbox } from "../designSystem/checkbox";
import { cn } from "../designSystem/cn";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../designSystem/popover";
import { Spinner } from "../designSystem/spinner";
import { useValPortal } from "../ValPortalProvider";

export type WorkTogetherState =
  | { state: "idle" }
  | { state: "opening" }
  | { state: "failed"; error: string };

/**
 * "Work together", from a chat on the SITE. valbuild/home
 * `docs/proposals.md`, Flow H.
 *
 * Chats on the site are the editor's own, so working together on one means
 * taking it into a proposal: this is Flow G's proposal card, offered by the
 * editor rather than by the AI. The click creates the proposal and moves the
 * chat into it (P10), and the invite menu opens there.
 *
 * It says, before the click, that the chat will be readable by the project:
 * moving it is what shares it, and that should not come as a surprise.
 */
export function WorkTogetherOffer({
  defaultName,
  changes,
  state = { state: "idle" },
  onOpen,
  className,
}: {
  /** The chat's name, or what it is about. */
  defaultName: string;
  /** Changes this chat made on the site, which can come along. */
  changes: number;
  state?: WorkTogetherState;
  onOpen: (options: { name: string; bringChanges: boolean }) => void;
  className?: string;
}) {
  const nameId = useId();
  const changesId = useId();
  const [name, setName] = useState(defaultName);
  const [bringChanges, setBringChanges] = useState(changes > 0);
  const opening = state.state === "opening";
  const trimmed = name.trim();
  return (
    <form
      className={cn(
        "flex w-80 max-w-full flex-col gap-3 p-3 text-sm",
        className,
      )}
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed && !opening) onOpen({ name: trimmed, bringChanges });
      }}
    >
      <div className="flex gap-2">
        <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-fg-secondary" />
        <p className="text-fg-primary">
          Working together happens in a proposal: a copy of the site you share
          with the people you invite. Nothing changes on the site until someone
          publishes it.
        </p>
      </div>
      <div>
        <label htmlFor={nameId} className="mb-1 block text-xs font-medium">
          Proposal name
        </label>
        <input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 w-full rounded-md border border-border-primary bg-bg-primary px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        />
      </div>
      {changes > 0 && (
        <label
          htmlFor={changesId}
          className="flex items-start gap-2 text-xs text-fg-primary"
        >
          <Checkbox
            id={changesId}
            checked={bringChanges}
            onCheckedChange={(checked) => setBringChanges(checked === true)}
          />
          <span>
            Bring this chat’s {changes === 1 ? "change" : `${changes} changes`}{" "}
            along. Left behind, {changes === 1 ? "it stays" : "they stay"}{" "}
            pending on the site.
          </span>
        </label>
      )}
      <p className="text-xs text-fg-secondary">
        This chat moves into the proposal, and everyone on the project can read
        and continue it.
      </p>
      {state.state === "failed" && (
        <p
          role="alert"
          className="flex items-start gap-1 text-xs text-fg-error-primary"
        >
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {state.error}
        </p>
      )}
      <Button
        type="submit"
        size="sm"
        disabled={!trimmed || opening}
        className="gap-1 self-end"
      >
        {opening && <Spinner size={12} />}
        {state.state === "failed" ? "Try again" : "Open proposal & invite"}
      </Button>
    </form>
  );
}

/** The header button of a chat on the site, and the offer it opens. */
export function WorkTogetherButton({
  open,
  onOpenChange,
  ...offer
}: ComponentProps<typeof WorkTogetherOffer> & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const portalContainer = useValPortal();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs touch:text-sm"
        >
          <Users className="h-3 w-3" />
          Work together
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={portalContainer}
        align="end"
        className="w-auto p-0"
      >
        <WorkTogetherOffer {...offer} />
      </PopoverContent>
    </Popover>
  );
}
