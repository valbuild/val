import { useState } from "react";
import { ArrowUp, Plus, Sparkles } from "lucide-react";
import { cn } from "../designSystem/cn";
import { FloatingPanel } from "./FloatingPanel";
import {
  ShellBreakpoint,
  ShellChatMessage,
  ShellProposalAction,
} from "./types";

export type AIChatPanelProps = {
  breakpoint: ShellBreakpoint;
  messages: ShellChatMessage[];
  suggestions: string[];
  /** Where the assistant is currently pointed, e.g. "Home › Hero". */
  context: string;
  onSend: (message: string) => void;
  onProposalAction: (messageId: string, action: ShellProposalAction) => void;
  onNewSession: () => void;
  onClose: () => void;
};

const ACTION_LABEL: Record<ShellProposalAction, string> = {
  insert: "Insert",
  apply: "Apply",
  replace: "Replace",
  "try-another": "Try another",
};

/**
 * The assistant panel: a chat that lives inside the CMS.
 *
 * Proposals are never applied on their own — every suggested change is shown
 * as a diffable block with explicit Apply / Replace / Insert actions, so the
 * assistant can never silently rewrite content.
 */
export function AIChatPanel({
  breakpoint,
  messages,
  suggestions,
  context,
  onSend,
  onProposalAction,
  onNewSession,
  onClose,
}: AIChatPanelProps) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setDraft("");
  };
  return (
    <FloatingPanel
      side="right"
      width={380}
      title="AI assistant"
      mobileVariant="bottom-sheet"
      breakpoint={breakpoint}
      onClose={onClose}
      headerAction={
        <button
          type="button"
          onClick={onNewSession}
          aria-label="New conversation"
          className="grid place-items-center w-7 h-7 rounded-md text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
        >
          <Plus size={15} />
        </button>
      }
      footer={
        <div className="p-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSend(suggestion)}
                className="h-7 px-2 rounded-full text-[0.6875rem] text-fg-secondary border border-border-float hover:bg-bg-float-raised hover:text-fg-primary"
              >
                {suggestion}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-1.5 p-1.5 rounded-lg bg-bg-float-raised">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder="Ask anything about this page…"
              aria-label="Message the assistant"
              className="flex-1 min-w-0 max-h-24 px-1.5 py-1 bg-transparent text-xs resize-none focus:outline-none placeholder:text-fg-secondary-alt"
            />
            <button
              type="button"
              onClick={submit}
              disabled={draft.trim() === ""}
              aria-label="Send"
              className="grid place-items-center w-7 h-7 shrink-0 rounded-md bg-bg-brand-primary text-fg-brand-primary border border-border-brand-primary hover:bg-bg-brand-primary-hover disabled:bg-bg-disabled disabled:border-border-float disabled:text-fg-disabled"
            >
              <ArrowUp size={14} />
            </button>
          </div>
          <p className="text-[0.625rem] text-fg-secondary-alt">
            The assistant can make mistakes. Nothing changes until you apply it.
          </p>
        </div>
      }
    >
      <div className="p-3 space-y-3">
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-float-raised text-[0.6875rem] text-fg-secondary">
          <Sparkles size={11} className="text-fg-secondary-alt" />
          Editing {context}
        </div>
        {messages.length === 0 && (
          <p className="text-xs text-fg-secondary-alt">
            Ask for a shorter heading, a meta description, or a suggestion for
            what this page is missing.
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex",
              message.role === "user" ? "justify-end" : "justify-start",
            )}
          >
            <div
              className={cn(
                "max-w-[85%] space-y-2",
                message.role === "user" &&
                  "px-2.5 py-1.5 rounded-lg rounded-br-sm bg-bg-float-raised text-fg-primary",
              )}
            >
              <p className="text-xs leading-relaxed">{message.text}</p>
              {message.proposal && (
                <div className="rounded-md border border-border-float bg-bg-surface overflow-hidden">
                  <div className="px-2.5 py-1.5 border-b border-border-float text-[0.625rem] text-fg-secondary-alt truncate">
                    {message.proposal.target}
                  </div>
                  <p className="px-2.5 py-2 text-xs text-fg-primary">
                    {message.proposal.content}
                  </p>
                  <div className="flex gap-1.5 px-2.5 pb-2">
                    {message.proposal.actions.map((action, index) => (
                      <button
                        key={action}
                        type="button"
                        onClick={() => onProposalAction(message.id, action)}
                        className={cn(
                          "h-6 px-2 rounded text-[0.6875rem] font-medium",
                          index === 0
                            ? "bg-bg-brand-primary text-fg-brand-primary hover:bg-bg-brand-primary-hover"
                            : "text-fg-secondary border border-border-float hover:bg-bg-float-raised hover:text-fg-primary",
                        )}
                      >
                        {ACTION_LABEL[action]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </FloatingPanel>
  );
}
