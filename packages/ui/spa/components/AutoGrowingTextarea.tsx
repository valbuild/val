import { useState } from "react";
import { cn } from "./designSystem/cn";

export function AutoGrowingTextarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  const [text, setText] = useState(props.value || props.defaultValue || "");
  const className =
    "flex rounded-md m-1 border border-border-primary bg-bg-primary px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div className="grid">
      <textarea
        {...props}
        className={cn(
          "resize-none overflow-hidden",
          className,
          props.className,
        )}
        style={{
          gridArea: "1 / 1 / 2 / 2",
        }}
        onInput={(ev) => {
          setText(ev.currentTarget.value);
          props.onInput?.(ev);
        }}
      />
      <div
        className={cn(
          "whitespace-pre-wrap invisible",
          className,
          props.className,
        )}
        style={{
          gridArea: "1 / 1 / 2 / 2",
        }}
      >
        {text + " "}
      </div>
    </div>
  );
}
