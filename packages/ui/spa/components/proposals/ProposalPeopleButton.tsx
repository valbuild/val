import { UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../designSystem/button";
import { cn } from "../designSystem/cn";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../designSystem/popover";
import { useValPortal } from "../ValPortalProvider";
import { PeopleStack } from "./PeopleStack";
import type { ProposalParticipant } from "./types";

/**
 * Who is working on a proposal, and the way to bring someone else in.
 * valbuild/home `docs/proposals.md`, Flow H. In the proposal bar and in the
 * header of a chat that belongs to a proposal.
 *
 * Alone, it says so ("Only you"): that is the moment an invite helps most, and
 * a lone avatar beside "Invite" reads as decoration.
 */
export function ProposalPeopleButton({
  people,
  viewerId,
  menu,
  open,
  onOpenChange,
  className,
}: {
  people: ProposalParticipant[];
  viewerId: string;
  /** The popover's content: `ProposalInviteMenu`. */
  menu: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const portalContainer = useValPortal();
  const alone = people.every((p) => p.id === viewerId);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-7 gap-1.5 px-1.5 text-xs touch:text-sm", className)}
        >
          {alone ? (
            <span className="text-fg-secondary">Only you</span>
          ) : (
            <PeopleStack people={people} />
          )}
          <UserPlus className="h-3 w-3" />
          Invite
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={portalContainer}
        align="end"
        className="w-auto p-0"
      >
        {menu}
      </PopoverContent>
    </Popover>
  );
}
