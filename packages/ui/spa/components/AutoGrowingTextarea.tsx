import { useState } from "react";
import { cn } from "./designSystem/cn";

export function AutoGrowingTextarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  const [text, setText] = useState(props.value || props.defaultValue || "");
  // The invisible ghost below is what gives the box its height, so it has to
  // follow a CONTROLLED value too: `text` only tracks typing, and a value that
  // arrives (or changes) from outside would otherwise leave the box sized for
  // the old one.
  const ghost = props.value ?? text;
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
        // A duplicate of the text, present only to give the grid cell its
        // height: hidden from assistive technology so it is not read out twice.
        aria-hidden="true"
        data-testid="auto-growing-textarea-ghost"
        className={cn(
          "whitespace-pre-wrap invisible",
          className,
          props.className,
        )}
        style={{
          gridArea: "1 / 1 / 2 / 2",
        }}
      >
        {ghost + " "}
      </div>
    </div>
  );
}
