import { Check, ChevronDown, Users } from "lucide-react";
import type { ReactNode } from "react";
import { ProfileAvatar } from "../components/Avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/designSystem/popover";
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

/**
 * The same filter, folded into a menu, for the nav.
 *
 * GitHub's Files-changed tree puts "owned by you or your team" in a filter menu
 * on the tree rather than in a band above the diff, and that is the right place
 * for the same reason it is here: whose changes you are looking at is a
 * property of the LIST, not of the comparison. As a band it cost a full
 * horizontal rule and a row of avatars on every screen, permanently, to serve
 * the least-used of this dialog's jobs.
 *
 * The trade is real and worth naming: the band answered "who else is publishing
 * right now" with no interaction at all, and a menu does not. What survives is
 * the count on the trigger — two people is a different publish from five, and
 * that is the part worth a glance.
 */
export function CompareAuthorFilterMenu({
  profiles,
  authorIds,
  selected,
  onSelect,
  mode,
  portalContainer,
  currentAuthorId = null,
  className,
}: {
  profiles: Record<string, Profile>;
  authorIds: string[];
  selected: string | null;
  onSelect: (authorId: string | null) => void;
  mode: "fs" | "http" | "unknown";
  portalContainer?: HTMLElement | null;
  /**
   * Who is looking, so they are first in the list and labelled.
   *
   * "Show me only my own changes" is the commonest reason anyone opens this
   * menu, and hunting for your own name among five is a worse way to do it
   * than reading it off the top. Null — no session, or a profile that has not
   * loaded — just means nobody is marked, never an entry that selects nothing.
   */
  currentAuthorId?: string | null;
  /** Width and placement, which differ between the nav and a toolbar. */
  className?: string;
}) {
  if (authorIds.length < 2) {
    return null;
  }
  const current = selected === null ? null : (profiles[selected] ?? null);
  /*
   * You first, then everyone else in the order they were given. Sorted here
   * rather than by the callers because both of them want it and neither knows
   * it needs to.
   */
  const ordered =
    currentAuthorId !== null && authorIds.includes(currentAuthorId)
      ? [currentAuthorId, ...authorIds.filter((id) => id !== currentAuthorId)]
      : authorIds;
  const nameOf = (authorId: string): string =>
    authorId === currentAuthorId
      ? `${profiles[authorId]?.fullName ?? authorId} (you)`
      : (profiles[authorId]?.fullName ?? authorId);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex min-w-0 items-center gap-1.5 rounded border px-2 py-1 text-xs",
            className ?? "w-full",
            selected === null
              ? "border-border-primary text-fg-secondary hover:bg-bg-secondary"
              : "border-border-brand-primary text-fg-brand-primary",
          )}
        >
          {selected === null ? (
            <Users size={12} className="shrink-0" aria-hidden />
          ) : (
            <ProfileAvatar profile={current} mode={mode} size="xs" />
          )}
          <span className="min-w-0 flex-1 truncate text-left">
            {selected === null
              ? `By anyone (${authorIds.length})`
              : selected === currentAuthorId
                ? `${current?.fullName ?? selected} (you)`
                : (current?.fullName ?? selected)}
          </span>
          <ChevronDown size={12} className="shrink-0" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        container={portalContainer}
        align="start"
        className="z-[9001] w-[220px] p-1"
      >
        <FilterOption
          label="Anyone"
          isSelected={selected === null}
          onSelect={() => onSelect(null)}
        />
        {ordered.map((authorId) => {
          const profile = profiles[authorId] ?? null;
          return (
            <FilterOption
              key={authorId}
              label={nameOf(authorId)}
              isSelected={selected === authorId}
              onSelect={() => onSelect(selected === authorId ? null : authorId)}
              avatar={<ProfileAvatar profile={profile} mode={mode} size="xs" />}
            />
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function FilterOption({
  label,
  isSelected,
  onSelect,
  avatar,
}: {
  label: string;
  isSelected: boolean;
  onSelect: () => void;
  avatar?: ReactNode;
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={isSelected}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
        isSelected
          ? "bg-bg-brand-primary text-fg-brand-primary-alt"
          : "text-fg-secondary hover:bg-bg-secondary",
      )}
    >
      {avatar ?? <span className="w-4 shrink-0" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {isSelected && <Check size={12} className="shrink-0" aria-hidden />}
    </button>
  );
}
