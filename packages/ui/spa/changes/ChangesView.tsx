import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  History,
  Sparkles,
  X,
} from "lucide-react";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/designSystem/button";
import { Checkbox } from "../components/designSystem/checkbox";
import { cn } from "../components/designSystem/cn";
import { ChangeKindIcon } from "../compare/ChangeKindIcon";
import { closeOverRequired } from "../compare/undoSelection";
import { undoWords } from "../compare/undoWords";
import { DiffFields } from "../diff/DiffValue";
import type { ChangeStep, ChangesModel } from "./types";

const WORDS = undoWords("discard");

/**
 * Changes: every step that is not published yet, and the way to take steps
 * back.
 *
 * The page Review links to. Review is read-only and shows the net change;
 * this is where the steps behind it are, each with who made it and when, and
 * the only place a pending change is reverted.
 *
 * ## Whose changes
 *
 * The chips select every step by one person, or by the assistant in one chat.
 * Your own are selected on arrival, because "take back what I did" is the
 * common reason to be here and nobody else's work should go by accident. A
 * chat is its own chip rather than part of the person who ran it: what the
 * assistant wrote for you is something you may want to throw away, or keep,
 * separately from what you typed.
 *
 * ## What goes with what
 *
 * A step made on top of another cannot stay when that one goes. Selecting one
 * pulls its dependents in, and the confirmation says how many came along and
 * whose they are, before anything is reverted.
 */
export function ChangesView({
  model,
  now,
  focusRowId = null,
  onClearFocus,
  onRevert,
  onBack,
  onRestore,
  onOpenSession,
}: {
  model: ChangesModel;
  /** The current time, so a story can hold it still. */
  now: Date;
  /**
   * The Review row a link came from. Only the steps behind it are listed,
   * open, until the filter is cleared.
   */
  focusRowId?: string | null;
  onClearFocus?: () => void;
  /** Called with every step that goes: the picks and what they pulled in. */
  onRevert: (stepIds: string[]) => void;
  /** Back to Review. */
  onBack?: () => void;
  /** Go to the published history. Absent where there is none. */
  onRestore?: () => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  const revertable = model.steps;
  const groups = useMemo(() => selectionGroups(model), [model]);
  const requiresById = useMemo(
    () =>
      new Map(
        model.steps
          .filter((step) => step.requires !== undefined)
          .map((step) => [step.id, step.requires ?? []]),
      ),
    [model.steps],
  );

  const [picked, setPicked] = useState<ReadonlySet<string>>(() => {
    const own = groups.find(
      (group) => group.kind === "person" && group.id === model.currentAuthorId,
    );
    return new Set(own?.stepIds ?? []);
  });
  const [confirming, setConfirming] = useState<"selected" | "all" | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const { selected, pulledIn } = useMemo(
    () => closeOverRequired(picked, requiresById),
    [picked, requiresById],
  );

  const focused = focusRowId !== null;
  const shown = focused
    ? model.steps.filter((step) => step.rowId === focusRowId)
    : model.steps;
  const focusTarget = focused ? shown[0]?.target : undefined;

  const togglePicked = (ids: string[], on: boolean): void => {
    const next = new Set(picked);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setPicked(next);
    setConfirming(null);
  };

  const goingIds =
    confirming === "all" ? revertable.map((step) => step.id) : [...selected];
  const othersGoing = othersAmong(
    model,
    confirming === "all" ? revertable : stepsOf(model, pulledIn),
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bg-primary text-fg-primary">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-primary px-4 py-3">
        {onBack !== undefined && (
          <Button size="xs" variant="ghost" onClick={onBack}>
            <ArrowLeft size={14} aria-hidden />
            Review
          </Button>
        )}
        <div className="min-w-0">
          <h1 className="text-base font-semibold">Changes</h1>
          <p className="truncate text-xs text-fg-secondary">
            {model.steps.length === 0
              ? "Nothing is pending"
              : `${model.steps.length} not published yet · ${WORDS.reassurance}`}
          </p>
        </div>
        {revertable.length > 0 && (
          <div className="ml-auto shrink-0">
            <Button
              size="xs"
              variant="secondary"
              onClick={() => setConfirming("all")}
            >
              {WORDS.all}…
            </Button>
          </div>
        )}
      </header>

      {model.steps.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-16">
          <p className="max-w-sm text-center text-sm text-fg-tertiary">
            Nothing is pending. Changes you make are listed here until they are
            published.
          </p>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 flex-col gap-2 border-b border-border-primary px-4 py-3">
            {confirming !== null ? (
              <Confirm
                count={goingIds.length}
                pulledIn={confirming === "selected" ? pulledIn.size : 0}
                others={othersGoing}
                onCancel={() => setConfirming(null)}
                onConfirm={() => {
                  onRevert(goingIds);
                  setPicked(new Set());
                  setConfirming(null);
                }}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-xs text-fg-secondary">
                  Select everything by
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {groups.map((group) => (
                    <GroupChip
                      key={`${group.kind}:${group.id}`}
                      group={group}
                      model={model}
                      picked={picked}
                      onToggle={(on) => togglePicked(group.stepIds, on)}
                    />
                  ))}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 md:ml-auto">
                  <span className="text-xs text-fg-secondary" role="status">
                    {selected.size === 0
                      ? "Nothing selected"
                      : `${selected.size} selected`}
                    {pulledIn.size > 0 &&
                      `, ${pulledIn.size} of them made on top of your picks`}
                  </span>
                  <Button
                    size="xs"
                    variant="destructive"
                    disabled={selected.size === 0}
                    onClick={() => setConfirming("selected")}
                  >
                    {WORDS.verb} {selected.size > 0 ? selected.size : ""}{" "}
                    selected…
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
            {focused && (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-border-secondary bg-bg-secondary px-3 py-2 text-xs">
                <History size={13} className="shrink-0 text-fg-tertiary" />
                <span className="min-w-0 truncate text-fg-secondary">
                  The steps behind{" "}
                  <span className="font-medium text-fg-primary">
                    {focusTarget ?? "this change"}
                  </span>
                </span>
                {onClearFocus !== undefined && (
                  <button
                    type="button"
                    onClick={onClearFocus}
                    className="ml-auto inline-flex shrink-0 items-center gap-1 text-fg-secondary hover:text-fg-primary"
                  >
                    <X size={12} aria-hidden />
                    Show all changes
                  </button>
                )}
              </div>
            )}
            {focused && shown.length === 0 && (
              <p className="py-10 text-center text-sm text-fg-tertiary">
                This change has no steps left: it was reverted or published.
              </p>
            )}
            {byDay(shown, now).map((day) => (
              <section key={day.label} className="mt-4">
                <h2 className="pb-1 text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
                  {day.label}
                </h2>
                <ul className="overflow-hidden rounded-md border border-border-secondary">
                  {day.steps.map((step) => (
                    <StepRow
                      key={step.id}
                      step={step}
                      model={model}
                      checked={selected.has(step.id)}
                      pulledIn={pulledIn.has(step.id)}
                      open={focused || open.has(step.id)}
                      onToggleOpen={() => {
                        const next = new Set(open);
                        if (next.has(step.id)) next.delete(step.id);
                        else next.add(step.id);
                        setOpen(next);
                      }}
                      onCheck={(on) => togglePicked([step.id], on)}
                      onOpenSession={onOpenSession}
                    />
                  ))}
                </ul>
              </section>
            ))}
            {model.published !== undefined && !focused && (
              <div className="mt-6 flex items-center gap-3 text-xs text-fg-tertiary">
                <span className="h-px flex-1 bg-border-secondary" />
                <span>
                  Published {model.published.when} by {model.published.by}
                </span>
                {onRestore !== undefined && (
                  <button
                    type="button"
                    onClick={onRestore}
                    className="font-medium text-fg-secondary underline underline-offset-2 hover:text-fg-primary"
                  >
                    Restore from history
                  </button>
                )}
                <span className="h-px flex-1 bg-border-secondary" />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- selection */

type SelectionGroup = {
  kind: "person" | "session";
  /** A profile id, or a session id. */
  id: string;
  /** The steps it selects. */
  stepIds: string[];
};

/**
 * One chip per person, for what they changed by hand, and one per chat, for
 * what the assistant changed in it. People first, the current one first of
 * all.
 */
export function selectionGroups(model: ChangesModel): SelectionGroup[] {
  const people = new Map<string, string[]>();
  const sessions = new Map<string, string[]>();
  for (const step of model.steps) {
    const into = step.session === undefined ? people : sessions;
    const key = step.session === undefined ? step.authorId : step.session.id;
    const existing = into.get(key);
    if (existing === undefined) into.set(key, [step.id]);
    else existing.push(step.id);
  }
  const groups: SelectionGroup[] = [];
  for (const [id, stepIds] of people) {
    groups.push({ kind: "person", id, stepIds });
  }
  groups.sort(
    (a, b) =>
      Number(b.id === model.currentAuthorId) -
      Number(a.id === model.currentAuthorId),
  );
  for (const [id, stepIds] of sessions) {
    groups.push({ kind: "session", id, stepIds });
  }
  return groups;
}

function GroupChip({
  group,
  model,
  picked,
  onToggle,
}: {
  group: SelectionGroup;
  model: ChangesModel;
  picked: ReadonlySet<string>;
  onToggle: (on: boolean) => void;
}) {
  const on = group.stepIds.filter((id) => picked.has(id)).length;
  const state: boolean | "indeterminate" =
    on === 0 ? false : on === group.stepIds.length ? true : "indeterminate";
  const session =
    group.kind === "session"
      ? model.steps.find((step) => step.session?.id === group.id)?.session
      : undefined;
  const profile = group.kind === "person" ? model.profiles[group.id] : null;
  const name =
    group.kind === "session"
      ? (session?.title ?? "A chat")
      : group.id === model.currentAuthorId
        ? "You"
        : (profile?.fullName ?? "Someone");
  return (
    <label
      className={cn(
        "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2 text-xs",
        state === false
          ? "border-border-secondary text-fg-secondary hover:bg-bg-secondary"
          : "border-border-primary bg-bg-secondary text-fg-primary",
      )}
    >
      <Checkbox
        checked={state}
        onCheckedChange={(value) => onToggle(value === true)}
        aria-label={`Select everything by ${name}`}
        className="h-3.5 w-3.5"
      />
      {group.kind === "session" ? (
        <Sparkles size={12} className="shrink-0" aria-hidden />
      ) : (
        <Avatar
          size="xs"
          name={profile?.fullName ?? null}
          imageUrl={profile?.avatar?.url}
          className="h-4 w-4 text-[8px]"
        />
      )}
      <span className="max-w-40 truncate">{name}</span>
      <span className="tabular-nums opacity-70">{group.stepIds.length}</span>
    </label>
  );
}

function stepsOf(model: ChangesModel, ids: ReadonlySet<string>): ChangeStep[] {
  return model.steps.filter((step) => ids.has(step.id));
}

/** The other people whose steps are among these, by name. */
function othersAmong(model: ChangesModel, steps: ChangeStep[]): string[] {
  const names = new Set<string>();
  for (const step of steps) {
    if (step.authorId === model.currentAuthorId) continue;
    names.add(model.profiles[step.authorId]?.fullName ?? "someone else");
  }
  return [...names];
}

function Confirm({
  count,
  pulledIn,
  others,
  onCancel,
  onConfirm,
}: {
  count: number;
  pulledIn: number;
  others: string[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label="Confirm revert"
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      <div className="min-w-0 flex-1 text-xs">
        <p className="font-semibold text-fg-primary">
          {WORDS.verb} {count} {count === 1 ? "change" : "changes"}?
        </p>
        <p className="text-fg-secondary">
          {pulledIn > 0 &&
            `${pulledIn} ${pulledIn === 1 ? "was" : "were"} made on top of what you selected, so ${
              pulledIn === 1 ? "it goes" : "they go"
            } too. `}
          {others.length > 0 && `This includes work by ${listOf(others)}. `}
          They are removed for everyone, and this cannot be undone.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="xs" variant="destructive" onClick={onConfirm}>
          {WORDS.verb} {count} {count === 1 ? "change" : "changes"}
        </Button>
      </div>
    </div>
  );
}

function listOf(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/* ------------------------------------------------------------------ rows */

function StepRow({
  step,
  model,
  checked,
  pulledIn,
  open,
  onToggleOpen,
  onCheck,
  onOpenSession,
}: {
  step: ChangeStep;
  model: ChangesModel;
  checked: boolean;
  /** Selected because something it was made on top of is. */
  pulledIn: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onCheck: (on: boolean) => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  const profile = model.profiles[step.authorId];
  const who =
    step.authorId === model.currentAuthorId
      ? "You"
      : (profile?.fullName ?? "Someone");
  const session = step.session;
  const requires = step.requires?.length ?? 0;
  return (
    <li
      className={cn(
        "border-b border-border-secondary last:border-b-0",
        checked && "bg-bg-secondary",
      )}
    >
      <div className="flex min-w-0 items-center gap-3 px-3 py-2">
        <Checkbox
          checked={checked}
          /*
           * A step that came along cannot be unticked on its own: the step it
           * was made on top of is going. It says why instead.
           */
          disabled={pulledIn}
          onCheckedChange={(value) => onCheck(value === true)}
          aria-label={`Select the change to ${step.target}`}
        />
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggleOpen}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 text-left"
        >
          <time
            dateTime={step.at}
            className="w-10 shrink-0 font-mono text-xs tabular-nums text-fg-tertiary"
          >
            {timeOf(step.at)}
          </time>
          <span className="flex w-28 shrink-0 items-center gap-1.5 text-xs text-fg-secondary">
            <Avatar
              size="xs"
              name={profile?.fullName ?? null}
              imageUrl={profile?.avatar?.url}
              className="h-5 w-5 text-[9px]"
            />
            <span className="truncate">{who}</span>
          </span>
          {/* On a phone the target takes a line of its own, under the rest. */}
          <span className="order-last min-w-0 basis-full truncate text-sm text-fg-primary md:order-none md:flex-1 md:basis-0">
            {step.target}
          </span>
          <span className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-fg-secondary md:ml-0 md:shrink-0">
            <ChangeKindIcon kind={step.change} size={12} hideLabel />
            <span className="truncate">{step.summary}</span>
          </span>
          {open ? (
            <ChevronDown size={14} className="shrink-0 text-fg-tertiary" />
          ) : (
            <ChevronRight size={14} className="shrink-0 text-fg-tertiary" />
          )}
        </button>
      </div>
      {(session !== undefined || requires > 0 || pulledIn) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2 pl-[2.75rem] pr-3 text-xs">
          {session !== undefined && (
            <span className="inline-flex min-w-0 items-center gap-1 text-fg-secondary">
              <Sparkles size={12} className="shrink-0" aria-hidden />
              <span className="truncate">
                By the assistant in "{session.title}"
              </span>
              {onOpenSession !== undefined && (
                <button
                  type="button"
                  onClick={() => onOpenSession(session.id)}
                  className="shrink-0 font-medium underline underline-offset-2 hover:text-fg-primary"
                >
                  Open chat
                </button>
              )}
            </span>
          )}
          {pulledIn ? (
            <span className="text-fg-warning-primary">
              Goes too: it was made on top of a change you selected.
            </span>
          ) : (
            requires > 0 && (
              <span className="text-fg-tertiary">
                Reverting this also reverts {requires} later{" "}
                {requires === 1 ? "change" : "changes"} made on top of it.
              </span>
            )
          )}
        </div>
      )}
      {open && (
        <div className="border-t border-border-secondary bg-bg-primary py-3 pl-[2.75rem] pr-3">
          {step.diff !== undefined && step.diff.length > 0 ? (
            <DiffFields fields={step.diff} layout="inline" nested />
          ) : (
            <p className="text-xs text-fg-tertiary">
              Nothing more to show for this step.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function timeOf(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The steps under the day they were made, newest day first. */
function byDay(
  steps: ChangeStep[],
  now: Date,
): { label: string; steps: ChangeStep[] }[] {
  const dayOf = (date: Date): number =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = dayOf(now);
  const days = new Map<number, ChangeStep[]>();
  for (const step of steps) {
    const day = dayOf(new Date(step.at));
    const existing = days.get(day);
    if (existing === undefined) days.set(day, [step]);
    else existing.push(step);
  }
  return [...days.entries()]
    .sort(([a], [b]) => b - a)
    .map(([day, daySteps]) => {
      const ago = Math.round((today - day) / 86_400_000);
      const label =
        ago === 0
          ? "Today"
          : ago === 1
            ? "Yesterday"
            : new Date(day).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
              });
      return { label, steps: daySteps };
    });
}
