import { useEffect, useState } from "react";
import { useCurrentPatchIds, usePublishSummary } from "./ValProvider";
import { Button } from "./designSystem/button";
import { Sparkles, Upload } from "lucide-react";
import { cn } from "./designSystem/cn";
import { deepEqual } from "@valbuild/core/patch";

export function PublishSummary({
  showPublishButton,
  onComplete,
}: {
  onComplete: () => void;
  showPublishButton?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const currentPatchIds = useCurrentPatchIds();
  const {
    summary,
    canGenerate,
    setSummary,
    publish,
    publishDisabled,
    generateSummary,
  } = usePublishSummary();
  const [staleWarning, setStaleWarning] = useState(false);
  const dismissStaleWarning = () => {
    setStaleWarning(false);
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
  const className = "w-full p-2 border rounded bg-bg-secondary";
  const text = "text" in summary ? summary.text : "";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between w-full gap-2">
        <span className="font-semibold">Summary</span>
        {canGenerate && (
          <Button
            className="truncate"
            disabled={!!summary.isGenerating}
            onClick={() => {
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
            }}
            variant="outline"
          >
            <span className="flex items-center gap-2">
              <span>{summary.isGenerating ? "Generating..." : "Generate"}</span>
              <Sparkles size={16} />
            </span>
          </Button>
        )}
      </div>
      {error && (
        <div className="p-4 rounded bg-bg-error-primary text-text-error-primary">
          {error}
        </div>
      )}
      <div className="grid text-xs font-light">
        {staleWarning && (
          <div className="flex flex-col items-center justify-center gap-4 p-4 cursor-pointer bg-bg-primary-solid">
            <div>This summary might be stale.</div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={dismissStaleWarning}>
                Dismiss
              </Button>
              {canGenerate && (
                <Button
                  onClick={() => {
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
                  }}
                  className="flex items-center gap-2"
                >
                  <span>
                    {summary.isGenerating ? "Generating..." : "Generate"}
                  </span>
                  <Sparkles size={16} />
                </Button>
              )}
            </div>
          </div>
        )}
        {/* https://css-tricks.com/the-cleanest-trick-for-autogrowing-textareas */}
        {!staleWarning && (
          <>
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
                setSummary({
                  type: "manual",
                  text: e.currentTarget.value,
                });
              }}
            />
          </>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 mt-4">
        {showPublishButton ? (
          <Button
            disabled={publishDisabled || text.trim() === "" || staleWarning}
            onClick={() => {
              if (summary.type === "not-asked") {
                return;
              }
              const summaryText = summary.text.trim();
              publish(summaryText)
                .then(() => {
                  onComplete();
                })
                .catch((e) => {
                  setError(e.message);
                });
            }}
            variant="default"
            className="flex items-center gap-2"
          >
            <span> {publishDisabled ? "Pushing..." : "Publish"}</span>
            <Upload size={16} />
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() => {
              onComplete();
            }}
          >
            Close
          </Button>
        )}
      </div>
    </div>
  );
}
