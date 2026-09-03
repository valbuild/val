import React, { useId, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Clock,
  Copy,
  Database,
  FilePlus,
  FileText,
  GitCompareArrows,
  Hash,
  HelpCircle,
  List,
  Loader2,
  Navigation,
  Paperclip,
  Pencil,
  Search,
  Sparkles,
  ShieldCheck,
  Tag,
  User,
  XCircle,
} from "lucide-react";
import { Button } from "./designSystem/button";
import { cn } from "./designSystem/cn";
import { ToolName } from "@valbuild/shared/internal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolActivityStatus = "pending" | "complete" | "error";

export type AskUserQuestionItem = {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
  defaults?: number[];
};

export type AskUserQuestionAnswer = {
  question: string;
  selectedOptions: number[];
  customAnswer: string | null;
};

export type ToolActivity = {
  toolCallId: string;
  name: string;
  status: ToolActivityStatus;
  questions?: AskUserQuestionItem[];
  answers?: AskUserQuestionAnswer[];
  cancelled?: boolean;
};

/**
 * True while an ask_user_question card is still open, i.e. the user has neither
 * submitted answers nor cancelled. Such an activity blocks the assistant turn.
 */
export function isPendingQuestion(activity: ToolActivity): boolean {
  return (
    activity.questions !== undefined &&
    activity.answers === undefined &&
    !activity.cancelled &&
    activity.status === "pending"
  );
}

// ---------------------------------------------------------------------------
// Tool activity display
// ---------------------------------------------------------------------------

const TOOL_DISPLAY: Record<ToolName, { label: string; icon: React.ReactNode }> =
  {
    get_all_schema: {
      label: "Reading schemas",
      icon: <Database className="h-3 w-3" />,
    },
    get_source: {
      label: "Reading content",
      icon: <FileText className="h-3 w-3" />,
    },
    search_content: {
      label: "Searching",
      icon: <Search className="h-3 w-3" />,
    },
    validate_content: {
      label: "Validating",
      icon: <ShieldCheck className="h-3 w-3" />,
    },
    create_patch: {
      label: "Updating content",
      icon: <Pencil className="h-3 w-3" />,
    },
    add_session_image_to_gallery: {
      label: "Adding image to gallery",
      icon: <Paperclip className="h-3 w-3" />,
    },
    remove_image_gallery_entry: {
      label: "Removing image from gallery",
      icon: <Paperclip className="h-3 w-3" />,
    },
    navigate_to: {
      label: "Navigating to content",
      icon: <Navigation className="h-3 w-3" />,
    },
    get_patches: {
      label: "Loading changes",
      icon: <Clock className="h-3 w-3" />,
    },
    get_source_path_from_route: {
      label: "Resolving route",
      icon: <Navigation className="h-3 w-3" />,
    },
    get_current_context: {
      label: "Gathering context",
      icon: <User className="h-3 w-3" />,
    },
    set_session_name: {
      label: "Naming session",
      icon: <Tag className="h-3 w-3" />,
    },
    show_compare_view: {
      label: "Opening compare view",
      icon: <GitCompareArrows className="h-3 w-3" />,
    },
    ask_user_question: {
      label: "Asking a question",
      icon: <HelpCircle className="h-3 w-3" />,
    },
    duplicate_source: {
      label: "Duplicating content",
      icon: <Copy className="h-3 w-3" />,
    },
    empty_at_path: {
      label: "Creating empty entry",
      icon: <FilePlus className="h-3 w-3" />,
    },
    count_entries: {
      label: "Counting entries",
      icon: <Hash className="h-3 w-3" />,
    },
    get_record_keys: {
      label: "Listing keys",
      icon: <List className="h-3 w-3" />,
    },
  };

type ToolDisplay = { label: string; icon: React.ReactNode };

/**
 * The same map, keyed by plain string.
 *
 * `TOOL_DISPLAY` is `Record<ToolName, …>` so that adding a tool to `toolNames`
 * fails to compile until it has a label. But the server can send a tool this
 * build has never heard of, which is exactly what the fallback below is for -
 * and `TOOL_DISPLAY[name as ToolName]` would assert away the very case it
 * handles, telling the compiler the lookup cannot miss. Widening by assignment
 * keeps both: the exhaustive check above, and an honest `| undefined` here.
 */
const TOOL_DISPLAY_BY_NAME: Partial<Record<string, ToolDisplay>> = TOOL_DISPLAY;

function toolDisplay(name: string): ToolDisplay {
  return (
    TOOL_DISPLAY_BY_NAME[name] ?? {
      label: name,
      icon: <Sparkles className="h-3 w-3" />,
    }
  );
}

/** What a status is called for a screen reader, where the icon says nothing. */
function statusLabel(status: ToolActivityStatus): string {
  if (status === "pending") return "Running";
  if (status === "error") return "Failed";
  return "Completed";
}

/**
 * The tool calls of one assistant turn, as a row of their own.
 *
 * Two groups, and they are laid out differently on purpose:
 *
 * - Plain tool calls collapse into a single summary row. They are progress,
 *   not content: while the turn runs the row names the tool that is running
 *   (shimmering, so "still working" reads without a spinner to stare at), and
 *   once it is done it collapses to a count the reader can open if they care.
 *   Listing every call inline pushed the answer off screen for no gain.
 * - `ask_user_question` activities stay outside the collapsible and always
 *   visible. The turn is BLOCKED on them - hiding one behind a chevron stalls
 *   the session with nothing on screen to say why.
 */
export function ToolActivities({
  activities,
  onSubmitAnswers,
  onCancel,
  defaultExpanded,
}: {
  activities: ToolActivity[];
  onSubmitAnswers: (
    toolCallId: string,
    answers: AskUserQuestionAnswer[],
  ) => void;
  onCancel: (toolCallId: string) => void;
  /** Stories and tests open the list without a click. */
  defaultExpanded?: boolean;
}) {
  const toolCalls = activities.filter((a) => a.questions === undefined);
  const questions = activities.filter((a) => a.questions !== undefined);
  if (activities.length === 0) {
    return null;
  }
  return (
    <div className="not-prose flex flex-col gap-1.5 min-w-0">
      {toolCalls.length > 0 && (
        <ToolCallGroup
          activities={toolCalls}
          defaultExpanded={defaultExpanded}
        />
      )}
      {questions.map((activity) => {
        if (isPendingQuestion(activity) && activity.questions) {
          return (
            <QuestionCard
              key={activity.toolCallId}
              questions={activity.questions}
              onSubmit={(answers) =>
                onSubmitAnswers(activity.toolCallId, answers)
              }
              onCancel={() => onCancel(activity.toolCallId)}
            />
          );
        }
        if (activity.questions && activity.answers) {
          return (
            <AnsweredQuestionSummary
              key={activity.toolCallId}
              answers={activity.answers}
              questions={activity.questions}
            />
          );
        }
        return (
          <div
            key={activity.toolCallId}
            className="flex items-center gap-1.5 text-xs py-0.5 text-fg-secondary"
          >
            <XCircle className="h-3 w-3" />
            <HelpCircle className="h-3 w-3" />
            <span>Question dismissed</span>
          </div>
        );
      })}
    </div>
  );
}

function summarize(activities: ToolActivity[]): string {
  // The running tool is what the reader wants named; only once nothing is
  // running does the row become a count of what happened.
  const running = activities.find((a) => a.status === "pending");
  if (running) {
    return `${toolDisplay(running.name).label}…`;
  }
  if (activities.length === 1) {
    return toolDisplay(activities[0].name).label;
  }
  return `Used ${activities.length} tools`;
}

function ToolCallGroup({
  activities,
  defaultExpanded,
}: {
  activities: ToolActivity[];
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded === true);
  const listId = useId();
  const running = activities.find((a) => a.status === "pending");
  const errorCount = activities.filter((a) => a.status === "error").length;
  const label = summarize(activities);
  const headIcon = toolDisplay(
    (running ?? activities[activities.length - 1]).name,
  ).icon;
  return (
    <div className="rounded-md border border-border-primary bg-bg-secondary overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-controls={listId}
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left",
          "text-xs touch:text-sm hover:bg-bg-secondary-hover transition-colors",
        )}
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-fg-tertiary transition-transform",
            expanded && "rotate-90",
          )}
        />
        <span className="shrink-0 text-fg-tertiary">{headIcon}</span>
        {/* The shimmer is on an INNER inline span: its background box is the
            text box, so the sweep is sized to the label rather than to the
            width of the row, where it would spend most of the cycle off the
            glyphs entirely. */}
        <span className="min-w-0 flex-1 truncate text-fg-secondary">
          <span className={cn(running && "val-shimmer-text")}>{label}</span>
        </span>
        {errorCount > 0 && (
          <span className="shrink-0 text-fg-error-on-surface">
            {errorCount} failed
          </span>
        )}
      </button>
      {expanded && (
        <ul
          id={listId}
          className="flex flex-col gap-1 border-t border-border-primary px-2.5 py-1.5"
        >
          {activities.map((activity) => {
            const display = toolDisplay(activity.name);
            return (
              <li
                key={activity.toolCallId}
                className={cn(
                  "flex items-center gap-1.5 text-xs touch:text-sm",
                  activity.status === "error"
                    ? "text-fg-error-on-surface"
                    : "text-fg-secondary",
                )}
              >
                {/* Status is a glyph and a colour, neither of which reaches a
                    screen reader - so the word goes in, and the two icons come
                    out. Without it "Updating content" is all three of running,
                    failed and done. */}
                <span className="shrink-0" aria-hidden="true">
                  {activity.status === "pending" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : activity.status === "error" ? (
                    <XCircle className="h-3 w-3" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                </span>
                <span className="sr-only">{statusLabel(activity.status)}</span>
                <span className="shrink-0 text-fg-tertiary" aria-hidden="true">
                  {display.icon}
                </span>
                <span className="min-w-0 truncate">
                  <span
                    className={cn(
                      activity.status === "pending" && "val-shimmer-text",
                    )}
                  >
                    {display.label}
                    {activity.status === "pending" ? "…" : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AnsweredQuestionSummary({
  questions,
  answers,
}: {
  questions: AskUserQuestionItem[];
  answers: AskUserQuestionAnswer[];
}) {
  return (
    <div className="flex flex-col gap-0.5 text-xs text-fg-secondary py-0.5">
      <div className="flex items-center gap-1.5">
        <HelpCircle className="h-3 w-3" />
        <span>Asked a question</span>
      </div>
      {answers.map((a, i) => {
        const q = questions[i];
        const parts: string[] = [];
        if (q) {
          a.selectedOptions.forEach((idx) => {
            const label = q.options[idx]?.label;
            if (label) parts.push(label);
          });
        }
        if (a.customAnswer) parts.push(a.customAnswer);
        const answerText = parts.join(", ") || "(no answer)";
        return (
          <div key={i} className="pl-4 truncate">
            <span className="text-fg-tertiary">Q:</span> {a.question}{" "}
            <span className="text-fg-tertiary">→</span> {answerText}
          </div>
        );
      })}
    </div>
  );
}

type DraftAnswer = {
  selected: Set<number>;
  custom: string;
  otherSelected: boolean;
};

function initialDrafts(questions: AskUserQuestionItem[]): DraftAnswer[] {
  return questions.map((q) => {
    const selected = new Set<number>();
    if (q.defaults && q.defaults.length > 0) {
      const validDefaults = q.defaults.filter(
        (idx) => Number.isInteger(idx) && idx >= 0 && idx < q.options.length,
      );
      if (q.multiSelect) {
        validDefaults.forEach((idx) => selected.add(idx));
      } else if (validDefaults.length > 0) {
        selected.add(validDefaults[0]);
      }
    }
    return { selected, custom: "", otherSelected: false };
  });
}

function QuestionCard({
  questions,
  onSubmit,
  onCancel,
}: {
  questions: AskUserQuestionItem[];
  onSubmit: (answers: AskUserQuestionAnswer[]) => void;
  onCancel: () => void;
}) {
  const [drafts, setDrafts] = useState<DraftAnswer[]>(() =>
    initialDrafts(questions),
  );
  const [submitted, setSubmitted] = useState(false);
  // Each group is labelled by its question text, so the ids must be unique
  // across the several cards a session can accumulate.
  const baseId = useId();

  const canSubmit = drafts.every(
    (d) =>
      d.selected.size > 0 || (d.otherSelected && d.custom.trim().length > 0),
  );

  const toggleOption = (qi: number, oi: number, multiSelect: boolean) => {
    if (submitted) return;
    setDrafts((prev) =>
      prev.map((d, i) => {
        if (i !== qi) return d;
        const next = new Set(d.selected);
        if (multiSelect) {
          if (next.has(oi)) next.delete(oi);
          else next.add(oi);
          return { ...d, selected: next };
        }
        next.clear();
        next.add(oi);
        // Single-select: picking an option deselects Other.
        return { ...d, selected: next, otherSelected: false };
      }),
    );
  };

  const selectOther = (qi: number, multiSelect: boolean) => {
    if (submitted) return;
    setDrafts((prev) =>
      prev.map((d, i) => {
        if (i !== qi) return d;
        if (multiSelect) {
          return { ...d, otherSelected: !d.otherSelected };
        }
        // Single-select: selecting Other deselects all listed options.
        return { ...d, selected: new Set<number>(), otherSelected: true };
      }),
    );
  };

  const setCustom = (qi: number, value: string, multiSelect: boolean) => {
    if (submitted) return;
    setDrafts((prev) =>
      prev.map((d, i) => {
        if (i !== qi) return d;
        // Typing in the Other input auto-selects Other. In single-select
        // mode, this also deselects the listed options.
        if (multiSelect) {
          return { ...d, custom: value, otherSelected: true };
        }
        return {
          ...d,
          custom: value,
          otherSelected: true,
          selected: new Set<number>(),
        };
      }),
    );
  };

  // Radio/checkbox navigation. Each question owns options 0..n-1 plus the
  // free-text row at index n, all addressed by `${qi}:${index}`.
  const radioRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const radioKey = (qi: number, index: number) => `${qi}:${index}`;

  // Single-select groups are radiogroups, so they get the radio keyboard
  // pattern: arrows move focus AND selection, and only the checked radio is in
  // the tab order (see checkedIndex below). Multi-select groups are checkboxes,
  // which are each individually tabbable and toggled with Space — that is the
  // native button behaviour, so they need no key handling.
  const handleRadioKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    qi: number,
    index: number,
    radioCount: number,
  ) => {
    let next: number;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      next = (index + 1) % radioCount;
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      next = (index - 1 + radioCount) % radioCount;
    } else {
      return;
    }
    e.preventDefault();
    const otherIndex = radioCount - 1;
    if (next === otherIndex) {
      selectOther(qi, false);
    } else {
      toggleOption(qi, next, false);
    }
    radioRefs.current.get(radioKey(qi, next))?.focus();
  };

  const handleSubmit = () => {
    if (submitted || !canSubmit) return;
    setSubmitted(true);
    const answers: AskUserQuestionAnswer[] = questions.map((q, i) => {
      const d = drafts[i];
      return {
        question: q.question,
        selectedOptions: Array.from(d.selected).sort((a, b) => a - b),
        customAnswer:
          d.otherSelected && d.custom.trim().length > 0
            ? d.custom.trim()
            : null,
      };
    });
    onSubmit(answers);
  };

  const handleCancel = () => {
    if (submitted) return;
    setSubmitted(true);
    onCancel();
  };

  return (
    <div className="not-prose flex flex-col gap-3 rounded-md border border-border-primary bg-bg-secondary p-3 my-2">
      <div className="flex items-center gap-1.5 text-xs text-fg-secondary">
        <HelpCircle className="h-3 w-3" />
        <span>Please answer to continue</span>
      </div>
      {questions.map((q, qi) => {
        const multiSelect = q.multiSelect === true;
        const draft = drafts[qi];
        const otherIndex = q.options.length;
        const radioCount = otherIndex + 1;
        const questionLabelId = `${baseId}-q${qi}`;
        // Roving tabindex for single-select: the checked radio is the group's
        // single tab stop, falling back to the first control when nothing is
        // checked yet. Checkboxes are each tabbable, so this is unused there.
        const checkedIndex = draft.otherSelected
          ? otherIndex
          : (Array.from(draft.selected).sort((a, b) => a - b)[0] ?? 0);
        const tabIndexFor = (index: number) =>
          multiSelect ? undefined : checkedIndex === index ? 0 : -1;
        return (
          <div key={qi} className="flex flex-col gap-1.5">
            {q.header && (
              <div className="text-xs uppercase tracking-wide text-fg-tertiary">
                {q.header}
              </div>
            )}
            <div id={questionLabelId} className="text-sm text-fg-primary">
              {q.question}
            </div>
            {/* The free-text row is the last choice inside the group, so it is
                reachable by arrow keys and counted in "n of m" announcements. */}
            <div
              role={multiSelect ? "group" : "radiogroup"}
              aria-labelledby={questionLabelId}
              className="flex flex-col gap-1"
            >
              {q.options.map((opt, oi) => {
                const isSelected = draft.selected.has(oi);
                return (
                  <button
                    key={oi}
                    ref={(el) => {
                      radioRefs.current.set(radioKey(qi, oi), el);
                    }}
                    type="button"
                    role={multiSelect ? "checkbox" : "radio"}
                    aria-checked={isSelected}
                    tabIndex={tabIndexFor(oi)}
                    disabled={submitted}
                    onClick={() => toggleOption(qi, oi, multiSelect)}
                    onKeyDown={
                      multiSelect
                        ? undefined
                        : (e) => handleRadioKeyDown(e, qi, oi, radioCount)
                    }
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors",
                      isSelected
                        ? "border-fg-primary bg-bg-primary"
                        : "border-border-primary bg-bg-primary hover:bg-bg-secondary",
                      submitted && "opacity-60 cursor-not-allowed",
                    )}
                  >
                    <span
                      className={cn(
                        "shrink-0 h-3.5 w-3.5 flex items-center justify-center border",
                        multiSelect ? "rounded-sm" : "rounded-full",
                        isSelected
                          ? "bg-fg-primary border-fg-primary"
                          : "border-border-primary",
                      )}
                    >
                      {isSelected && multiSelect && (
                        <Check className="h-2.5 w-2.5 text-bg-primary" />
                      )}
                      {isSelected && !multiSelect && (
                        <span className="h-1.5 w-1.5 rounded-full bg-bg-primary" />
                      )}
                    </span>
                    <span className="flex-1 leading-tight">
                      <span className="block text-fg-primary">{opt.label}</span>
                      {opt.description && (
                        <span className="block text-xs text-fg-secondary">
                          {opt.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors",
                  draft.otherSelected
                    ? "border-fg-primary bg-bg-primary"
                    : "border-border-primary bg-bg-primary",
                  submitted && "opacity-60",
                )}
              >
                <button
                  ref={(el) => {
                    radioRefs.current.set(radioKey(qi, otherIndex), el);
                  }}
                  type="button"
                  role={multiSelect ? "checkbox" : "radio"}
                  aria-checked={draft.otherSelected}
                  aria-label="Other"
                  tabIndex={tabIndexFor(otherIndex)}
                  disabled={submitted}
                  onClick={() => selectOther(qi, multiSelect)}
                  onKeyDown={
                    multiSelect
                      ? undefined
                      : (e) => handleRadioKeyDown(e, qi, otherIndex, radioCount)
                  }
                  className={cn(
                    "shrink-0 h-3.5 w-3.5 flex items-center justify-center border",
                    multiSelect ? "rounded-sm" : "rounded-full",
                    draft.otherSelected
                      ? "bg-fg-primary border-fg-primary"
                      : "border-border-primary",
                    submitted && "cursor-not-allowed",
                  )}
                >
                  {draft.otherSelected && multiSelect && (
                    <Check className="h-2.5 w-2.5 text-bg-primary" />
                  )}
                  {draft.otherSelected && !multiSelect && (
                    <span className="h-1.5 w-1.5 rounded-full bg-bg-primary" />
                  )}
                </button>
                <input
                  type="text"
                  disabled={submitted}
                  placeholder="Other (type your own answer)"
                  value={draft.custom}
                  onChange={(e) => setCustom(qi, e.target.value, multiSelect)}
                  className={cn(
                    "flex-1 bg-transparent text-fg-primary",
                    "focus:outline-none placeholder:text-fg-tertiary",
                  )}
                />
              </div>
            </div>
          </div>
        );
      })}
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          disabled={submitted}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={submitted || !canSubmit}
        >
          Submit
        </Button>
      </div>
    </div>
  );
}
