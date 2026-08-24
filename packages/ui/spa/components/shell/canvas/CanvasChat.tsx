import { useState } from "react";
import { ArrowUp, Paperclip, Sparkles, X } from "lucide-react";
import { cn } from "../../designSystem/cn";
import { CanvasChatAttachment, CanvasChatMessage } from "./types";

/**
 * The assistant, with whatever you picked off the page attached to it.
 *
 * The attachment row above the input is the point: you select things on the
 * canvas, they collect here as chips, and the message you write is about
 * them. It saves describing in words the thing you are already pointing at.
 */
export function CanvasChat({
  messages,
  attachments,
  onRemoveAttachment,
  onSend,
  suggestions,
  className,
}: {
  messages: CanvasChatMessage[];
  attachments: CanvasChatAttachment[];
  onRemoveAttachment: (fieldId: string) => void;
  onSend: (text: string) => void;
  suggestions?: string[];
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setDraft("");
  };
  return (
    <div className={cn("flex h-full flex-col bg-bg-float", className)}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-float px-4">
        <Sparkles size={13} className="text-fg-secondary-alt" />
        <span className="text-[0.8125rem] font-semibold tracking-tight">
          Assistant
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex",
              message.role === "user" ? "justify-end" : "justify-start",
            )}
          >
            <div className="max-w-[85%] space-y-1.5">
              {message.attachments && message.attachments.length > 0 && (
                <div className="flex flex-wrap justify-end gap-1">
                  {message.attachments.map((attachment) => (
                    <span
                      key={attachment.fieldId}
                      className="inline-flex items-center gap-1 rounded border border-border-float px-1.5 py-0.5 text-[0.625rem] text-fg-secondary-alt"
                    >
                      <Paperclip size={9} />
                      {attachment.label}
                    </span>
                  ))}
                </div>
              )}
              <p
                className={cn(
                  "text-xs leading-relaxed",
                  message.role === "user" &&
                    "rounded-lg rounded-br-sm bg-bg-float-raised px-2.5 py-1.5",
                )}
              >
                {message.text}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="shrink-0 space-y-2 border-t border-border-float p-3">
        {attachments.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {attachments.map((attachment) => (
              <span
                key={attachment.fieldId}
                className="inline-flex items-center gap-1 rounded-md border border-border-brand-primary bg-bg-surface py-0.5 pl-1.5 pr-0.5 text-[0.6875rem]"
              >
                <Paperclip size={10} className="text-fg-secondary-alt" />
                {attachment.label}
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(attachment.fieldId)}
                  aria-label={`Remove ${attachment.label}`}
                  className="grid h-4 w-4 place-items-center rounded text-fg-secondary-alt hover:bg-bg-float-raised hover:text-fg-primary"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        {suggestions && suggestions.length > 0 && attachments.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSend(suggestion)}
                className="h-7 rounded-full border border-border-float px-2 text-[0.6875rem] text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5 rounded-lg bg-bg-float-raised p-1.5">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={
              attachments.length > 0
                ? "What should change about these?"
                : "Ask anything about this page…"
            }
            aria-label="Message the assistant"
            className="max-h-24 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1 text-xs placeholder:text-fg-secondary-alt focus:outline-none"
          />
          <button
            type="button"
            onClick={submit}
            disabled={draft.trim() === ""}
            aria-label="Send"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border-brand-primary bg-bg-brand-primary text-fg-brand-primary hover:bg-bg-brand-primary-hover disabled:border-border-float disabled:bg-bg-disabled disabled:text-fg-disabled"
          >
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
