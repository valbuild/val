import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { cn } from "../components/designSystem/cn";
import { ChangeMark, DiffLines } from "../components/proposals/DiffArea";
import type { ReviewCode, ReviewCodeFile, ReviewCodeGroup } from "./types";

/**
 * A proposal's code changes, in Review: every changed file, under the
 * conversation with the assistant that changed it.
 *
 * Grouped by conversation because that is the question a reviewer has about
 * code they did not write: what was asked for. The conversation is one click
 * away from the files it produced.
 */
export function ReviewCodePane({
  code,
  onOpenSession,
}: {
  code: ReviewCode;
  /** Open the conversation. Absent hides the link. */
  onOpenSession?: (sessionId: string) => void;
}) {
  const first = code.groups[0]?.files[0]?.path;
  const [open, setOpen] = useState<ReadonlySet<string>>(
    new Set(first === undefined ? [] : [first]),
  );
  const toggle = (path: string): void => {
    const next = new Set(open);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setOpen(next);
  };
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {code.groups.map((group, index) => (
        <section key={group.session?.id ?? `none-${index}`} className="min-w-0">
          <GroupHeading group={group} onOpenSession={onOpenSession} />
          <ul className="min-w-0 overflow-hidden rounded-md border border-border-secondary">
            {group.files.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                open={open.has(file.path)}
                onToggle={() => toggle(file.path)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function GroupHeading({
  group,
  onOpenSession,
}: {
  group: ReviewCodeGroup;
  onOpenSession?: (sessionId: string) => void;
}) {
  const session = group.session;
  if (session === null) {
    return (
      <div className="mb-2 text-sm font-medium text-fg-primary">
        Not from a chat
        <span className="pl-2 text-xs font-normal text-fg-tertiary">
          Changed by an upgrade or pushed from outside the Studio
        </span>
      </div>
    );
  }
  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <Sparkles size={14} className="shrink-0 text-fg-secondary" aria-hidden />
      <span className="min-w-0 truncate text-sm font-medium text-fg-primary">
        {session.title}
      </span>
      <span className="text-xs text-fg-tertiary">
        {session.by} with the assistant · {session.when}
      </span>
      {onOpenSession !== undefined && (
        <button
          type="button"
          onClick={() => onOpenSession(session.id)}
          className="ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border-secondary px-2 text-xs font-medium text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
        >
          <MessageSquare size={13} aria-hidden />
          Open chat
        </button>
      )}
    </div>
  );
}

function FileRow({
  file,
  open,
  onToggle,
}: {
  file: ReviewCodeFile;
  open: boolean;
  onToggle: () => void;
}) {
  const slash = file.path.lastIndexOf("/");
  return (
    <li className="min-w-0 border-b border-border-secondary last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-secondary"
      >
        {open ? (
          <ChevronDown size={14} className="shrink-0 text-fg-tertiary" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-fg-tertiary" />
        )}
        <ChangeMark change={file.change} />
        <span className="min-w-0 truncate font-mono text-xs" title={file.path}>
          <span className="text-fg-tertiary">
            {file.path.slice(0, slash + 1)}
          </span>
          <span
            className={cn(
              "text-fg-primary",
              file.change === "deleted" && "line-through",
            )}
          >
            {file.path.slice(slash + 1)}
          </span>
        </span>
        <span className="ml-auto shrink-0 font-mono text-xs tabular-nums">
          {file.added > 0 && (
            <span className="text-emerald-600 dark:text-emerald-400">
              +{file.added}
            </span>
          )}
          {file.removed > 0 && (
            <span className="pl-2 text-rose-600 dark:text-rose-400">
              −{file.removed}
            </span>
          )}
        </span>
      </button>
      {open && (
        <DiffLines
          lines={file.lines}
          className="overflow-x-auto border-t border-border-secondary bg-bg-primary py-2"
        />
      )}
    </li>
  );
}

/** `4 files · 2 chats`, for the nav entry and the pane's heading. */
export function codeSummary(code: ReviewCode): string {
  const files = code.groups.reduce((sum, group) => sum + group.files.length, 0);
  const sessions = code.groups.filter((group) => group.session !== null).length;
  const parts = [`${files} ${files === 1 ? "file" : "files"}`];
  if (sessions > 0) {
    parts.push(`${sessions} ${sessions === 1 ? "chat" : "chats"}`);
  }
  return parts.join(" · ");
}
