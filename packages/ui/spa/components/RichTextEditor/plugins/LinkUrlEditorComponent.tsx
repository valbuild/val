import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "../../designSystem/button";
import { Input } from "../../designSystem/input";
import { cn } from "../../designSystem/cn";

export interface LinkUrlEditorProps {
  currentHref: string;
  isNewLink: boolean;
  onApply: (href: string) => void;
  onUnlink: () => void;
  onClose: () => void;
}

export function LinkUrlEditor({
  currentHref,
  isNewLink,
  onApply,
  onUnlink,
  onClose,
}: LinkUrlEditorProps) {
  const [href, setHref] = useState(currentHref);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const handleApply = useCallback(() => {
    const trimmed = href.trim();
    if (!trimmed) return;
    onApply(trimmed);
  }, [href, onApply]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        handleApply();
      }
    },
    [onClose, handleApply],
  );

  return (
    <>
      <Input
        ref={inputRef}
        type="text"
        value={href}
        onChange={(e) => setHref(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="URL"
        placeholder="https://…"
        className={cn("h-8 m-0 min-w-[220px] w-auto text-sm")}
      />
      <Button size="xs" onMouseDown={handleApply}>
        {isNewLink ? "Apply" : "Update"}
      </Button>
      {!isNewLink && (
        <Button variant="ghost" size="xs" onMouseDown={onUnlink}>
          Unlink
        </Button>
      )}
    </>
  );
}
