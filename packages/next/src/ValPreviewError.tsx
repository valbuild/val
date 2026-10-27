"use client";

/**
 * EXPERIMENTAL: the error UI of the component preview route.
 *
 * Component code is rewritten outside of Val, so a preview will regularly be
 * asked to render code that throws. Without a boundary the route answers 500
 * and the editor sees a blank iframe (and in production, no message at all).
 * This keeps the failure inside the preview, and readable.
 *
 * Use it as the `error.tsx` of the preview route segment:
 *
 * @example
 * // app/val-preview/error.tsx
 * "use client";
 * export { ValPreviewError as default } from "@valbuild/next";
 *
 * NOTE: this catches errors thrown while rendering. A component that does not
 * compile is a build error, which no React boundary can catch - the app's own
 * build/dev error output is the only thing that can report those.
 */
export function ValPreviewError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        fontFamily: "ui-monospace, monospace",
        fontSize: "13px",
        lineHeight: 1.5,
        padding: "1rem",
        display: "grid",
        gap: "0.75rem",
        justifyItems: "start",
      }}
    >
      <strong>This component threw while rendering.</strong>
      <pre
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxWidth: "100%",
        }}
      >
        {/* In production Next.js replaces the message with a digest */}
        {error.message || `Error digest: ${error.digest ?? "unknown"}`}
      </pre>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
