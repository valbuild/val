import { Users } from "lucide-react";
import { ProfileAvatar } from "../components/Avatar";
import { cn } from "../components/designSystem/cn";
import type { Profile } from "../components/ValProvider";

/**
 * "Whose changes am I looking at" — a row of the people in this publish.
 *
 * A row of avatars rather than a dropdown, because the set is small (the people
 * who happen to have staged something) and the useful gesture is recognising a
 * face and clicking it, not reading a list. It also makes the answer to "who
 * else is publishing right now" visible without any interaction, which is worth
 * having on a screen whose whole job is to be read before a publish.
 *
 * Hidden entirely when one person did everything: a filter with a single option
 * cannot narrow anything, and a control that does nothing teaches people to
 * distrust the ones that do.
 */
export function CompareAuthorFilter({
  profiles,
  authorIds,
  selected,
  onSelect,
  mode,
}: {
  profiles: Record<string, Profile>;
  /** Everyone with a staged change, in the order they should appear. */
  authorIds: string[];
  selected: string | null;
  onSelect: (authorId: string | null) => void;
  mode: "fs" | "http" | "unknown";
}) {
  if (authorIds.length < 2) {
    return null;
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span
        className="flex shrink-0 items-center gap-1 text-xs text-fg-tertiary"
        id="compare-author-filter-label"
      >
        <Users size={12} aria-hidden />
        By
      </span>
      <div
        className="flex min-w-0 flex-wrap items-center gap-1"
        role="group"
        aria-labelledby="compare-author-filter-label"
      >
        <button
          onClick={() => onSelect(null)}
          aria-pressed={selected === null}
          className={cn(
            "rounded-full border px-2 py-0.5 text-xs",
            selected === null
              ? "border-border-brand-primary bg-bg-brand-primary text-fg-brand-primary-alt"
              : "border-border-primary text-fg-secondary hover:bg-bg-secondary",
          )}
        >
          Everyone
        </button>
        {authorIds.map((authorId) => {
          const profile = profiles[authorId] ?? null;
          const isSelected = selected === authorId;
          return (
            <button
              key={authorId}
              /*
               * Clicking the selected person clears the filter rather than
               * re-applying it. The row has no other "off" for a chosen avatar,
               * and reaching back to "Everyone" to undo one click is a step
               * nobody expects to need.
               */
              onClick={() => onSelect(isSelected ? null : authorId)}
              aria-pressed={isSelected}
              title={profile?.fullName ?? authorId}
              className={cn(
                "flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-2 text-xs",
                isSelected
                  ? "border-border-brand-primary bg-bg-brand-primary text-fg-brand-primary-alt"
                  : "border-border-primary text-fg-secondary hover:bg-bg-secondary",
              )}
            >
              <ProfileAvatar profile={profile} mode={mode} size="xs" />
              <span className="max-w-[9rem] truncate">
                {profile?.fullName ?? authorId}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Everyone with a change in this publish, deduplicated, in nav order.
 *
 * Taken from the nav's `authorIds` rather than from the panes: the nav is the
 * complete set of changed things by construction, and walking every pane would
 * also count people whose only appearance is on a row the current filter has
 * already hidden — which would make the filter row flicker as you use it.
 */
export function authorsInModel(
  sections: { nodes: { authorIds?: string[]; children?: unknown[] }[] }[],
): string[] {
  const seen: string[] = [];
  const walk = (nodes: unknown[]): void => {
    for (const node of nodes) {
      const typed = node as { authorIds?: string[]; children?: unknown[] };
      for (const id of typed.authorIds ?? []) {
        if (!seen.includes(id)) {
          seen.push(id);
        }
      }
      walk(typed.children ?? []);
    }
  };
  for (const section of sections) {
    walk(section.nodes);
  }
  return seen;
}
