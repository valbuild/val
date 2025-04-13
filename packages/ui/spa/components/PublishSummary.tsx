import { useCallback, useEffect, useState } from "react";
import { useCurrentPatchIds, usePublishSummary } from "./ValProvider";
import { Button } from "./designSystem/button";
import { Sparkles, Upload } from "lucide-react";
import { cn } from "./designSystem/cn";
import { deepEqual } from "@valbuild/core/patch";

export function PublishSummary({
  onPublish,
  onClose,
}: {
  onPublish?: () => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const currentPatchIds = useCurrentPatchIds();
  const { summary, canGenerate, setSummary, publishDisabled, generateSummary } =
    usePublishSummary();
  const [staleWarning, setStaleWarning] = useState(false);
  const dismissStaleWarning = () => {
    setStaleWarning(false);
    if (summary.type !== "not-asked") {
      // Reset summary so that it has the current patch ids
      // and is not marked as stale
      setSummary({
        ...summary,
      });
    }
  };
  useEffect(() => {
    if (
      summary.type !== "not-asked" &&
      !summary.isGenerating &&
      !deepEqual(summary.patchIds, currentPatchIds)
    ) {
      setStaleWarning(true);
    }
  }, [summary, currentPatchIds]);
  const generateSummaryCallback = useCallback(() => {
    dismissStaleWarning();
    generateSummary().then((summary) => {
      if (summary.type === "ai") {
        setSummary({
          type: "ai",
          text: summary.text.trim(),
        });
      } else {
        setError(summary.message);
      }
    });
  }, [dismissStaleWarning, generateSummary, setSummary, setError]);
  const className = "w-full p-2 border rounded bg-bg-secondary";
  const text = "text" in summary ? summary.text : "";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between w-full gap-2">
        <span className="font-semibold">Summary</span>
        {canGenerate && (
          <GenerateSummary
            onClick={generateSummaryCallback}
            isGenerating={summary.isGenerating}
          />
        )}
      </div>
      {error && (
        <div className="p-4 rounded bg-bg-error-primary text-text-error-primary">
          {error}
        </div>
      )}
      <div className="grid text-xs font-light">
        {/* https://css-tricks.com/the-cleanest-trick-for-autogrowing-textareas */}
        <div
          aria-hidden
          className={cn(className, "invisible whitespace-pre-wrap")}
          style={{
            gridArea: "1 / 1 / 2 / 2",
          }}
        >
          {/* https://css-tricks.com/the-cleanest-trick-for-autogrowing-textareas */}
          {/* Note the weird space! Needed to prevent jumpy behavior */}
          {text + " "}
        </div>
        <textarea
          disabled={!!summary.isGenerating}
          className={cn(
            className,
            "resize-none overflow-clip disabled:opacity-50",
          )}
          value={text}
          style={{
            gridArea: "1 / 1 / 2 / 2",
          }}
          placeholder={
            "Write a summary of your changes" +
            (canGenerate ? " or generate one using AI" : "")
          }
          onChange={(e) => {
            dismissStaleWarning();
            setSummary({
              type: "manual",
              text: e.currentTarget.value,
            });
          }}
        />
      </div>
      <div
        className={cn(
          "p-2 text-xs flex-grow font-light bg-bg-warning-primary text-[black] rounded flex items-center",
          "flex justify-between w-full gap-2 py-2",
          {
            hidden: !staleWarning,
          },
        )}
        aria-hidden={staleWarning}
      >
        <span>Summary might be outdated. </span>
        <button className="underline" onClick={dismissStaleWarning}>
          Dismiss
        </button>
      </div>
      <div className="flex items-center justify-end gap-2">
        {onPublish ? (
          <>
            <Button
              variant="outline"
              onClick={() => {
                onClose();
              }}
            >
              Close
            </Button>
            {staleWarning && canGenerate && (
              <GenerateSummary
                isGenerating={summary.isGenerating}
                onClick={generateSummaryCallback}
              />
            )}
            {!staleWarning && (
              <Button
                disabled={publishDisabled || text.trim() === ""}
                onClick={() => {
                  if (summary.type === "not-asked") {
                    return;
                  }
                  onPublish();
                }}
                variant="default"
                className="flex items-center gap-2"
              >
                <span> {publishDisabled ? "Pushing..." : "Publish"}</span>
                <Upload size={16} />
              </Button>
            )}
          </>
        ) : (
          <>
            <Button
              variant="outline"
              onClick={() => {
                onClose();
              }}
            >
              Close
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function GenerateSummary({
  isGenerating,
  onClick,
}: {
  isGenerating?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      className="truncate"
      disabled={!!isGenerating}
      onClick={() => {
        onClick();
      }}
      variant="outline"
    >
      <span className="flex items-center gap-2">
        <span>{isGenerating ? "Generating..." : "Generate"}</span>
        <Sparkles size={16} />
      </span>
    </Button>
  );
}
