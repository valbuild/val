import type { EditorError, EditorErrorFix } from "../types";

export function ErrorTooltip({
  error,
  onApplyFix,
}: {
  error: EditorError;
  onApplyFix?: (args: { path: string; kind: string; fixId: string }) => void;
}) {
  const fixes = error.fixes as EditorErrorFix[] | undefined;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-fg-error-primary font-medium text-sm">
        {error.message}
      </div>
      {fixes && fixes.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {fixes.map((fix) => (
            <button
              key={fix.id}
              type="button"
              className={[
                "rounded px-2 py-0.5 text-xs font-medium",
                "border border-border-error-primary text-fg-error-primary",
                "hover:bg-bg-error-secondary-hover",
              ].join(" ")}
              onClick={(e) => {
                e.preventDefault();
                onApplyFix?.({
                  path: error.path,
                  kind: error.kind,
                  fixId: fix.id,
                });
              }}
            >
              {fix.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
