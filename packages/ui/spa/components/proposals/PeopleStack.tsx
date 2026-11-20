import { Avatar } from "../Avatar";
import { cn } from "../designSystem/cn";
import type { ProposalParticipant } from "./types";

/**
 * The people on a proposal or in a chat, as overlapping avatars with a `+N`
 * past `max`. valbuild/home `docs/proposals.md`, Flow H: the proposal bar,
 * the chat header and the chat list all show who is working on it.
 *
 * Not `AvatarStack` (ComparePatchSets): that one takes author ids and a
 * profile lookup, and these people arrive with their names already.
 */
export function PeopleStack({
  people,
  max = 3,
  size = "xs",
  className,
}: {
  people: ProposalParticipant[];
  max?: number;
  /** The two sizes the `+N` badge is drawn for. */
  size?: "xs" | "sm";
  className?: string;
}) {
  if (people.length === 0) return null;
  // `+N` takes a slot of its own, so showing `max` people and "+1" would be
  // wider than showing `max + 1` people: show them all when only one is over.
  const visible = people.length > max + 1 ? people.slice(0, max) : people;
  const overflow = people.length - visible.length;
  return (
    <span
      className={cn("flex items-center", className)}
      aria-label={people.map((p) => p.name).join(", ")}
    >
      {visible.map((person, i) => (
        <Avatar
          key={person.id}
          name={person.name}
          imageUrl={person.avatarUrl}
          size={size}
          className={cn("border-2 border-bg-primary", i > 0 && "-ml-1.5")}
        />
      ))}
      {overflow > 0 && (
        <span
          aria-hidden
          className={cn(
            "-ml-1.5 grid place-items-center rounded-full border-2 border-bg-primary",
            "bg-bg-secondary text-fg-secondary font-semibold",
            size === "xs"
              ? "h-6 min-w-6 px-1 text-[0.625rem]"
              : "h-7 min-w-7 px-1 text-[0.6875rem]",
          )}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}
