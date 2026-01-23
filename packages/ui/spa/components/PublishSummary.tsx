import { usePublishSummary } from "./ValProvider";
import { Button } from "./designSystem/button";
import { Upload } from "lucide-react";
import { cn } from "./designSystem/cn";

export function PublishSummary({
  onPublish,
  onClose,
}: {
  onPublish?: () => void;
  onClose: () => void;
}) {
  const { summary, setSummary, publishDisabled } = usePublishSummary();

  const className = "w-full p-2 border rounded bg-bg-secondary";
  const text = "text" in summary ? summary.text : "";

  return (
    <div className="flex flex-col gap-4">
      <span className="font-semibold">Summary</span>
      <div className="grid text-xs font-light">
        {/* https://css-tricks.com/the-cleanest-trick-for-autogrowing-textareas */}
        <div
          aria-hidden
          className={cn(className, "invisible whitespace-pre-wrap")}
          style={{
            gridArea: "1 / 1 / 2 / 2",
          }}
        >
          {/* Note the weird space! Needed to prevent jumpy behavior */}
          {(summary.isGenerating ? "" : text) + " "}
        </div>
        <textarea
          disabled={!!summary.isGenerating}
          className={cn(
            className,
            "resize-none overflow-clip disabled:opacity-50",
          )}
          value={summary.isGenerating ? "" : text}
          style={{
            gridArea: "1 / 1 / 2 / 2",
          }}
          placeholder={
            summary.isGenerating
              ? "Generating summary..."
              : "Write a summary of your changes"
          }
          onChange={(e) => {
            setSummary({
              type: "manual",
              text: e.currentTarget.value,
            });
          }}
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        {summary.isGenerating && (
          <Button
            variant="outline"
            onClick={() => {
              setSummary({ type: "manual", text: "" });
            }}
          >
            Cancel
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => {
            // Reset to "not-asked" if text is empty so it will regenerate on next open
            if (text.trim() === "") {
              setSummary({ type: "not-asked" });
            }
            onClose();
          }}
        >
          Close
        </Button>
        {onPublish && (
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
            <span>{publishDisabled ? "Pushing..." : "Publish"}</span>
            <Upload size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}
