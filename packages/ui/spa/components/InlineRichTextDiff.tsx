import {
  AllRichTextOptions,
  RichTextSource,
  SerializedRichTextOptions,
} from "@valbuild/core";
import { useRichTextEditor } from "./RichTextEditor";
import { ReadOnlyRichTextEditor } from "./ReadOnlyRichTextEditor";
import { richTextToRemirror } from "@valbuild/shared/internal";
import { useMemo } from "react";

export function InlineRichTextDiff({
  before,
  after,
  options,
}: {
  before: RichTextSource<AllRichTextOptions>;
  after: RichTextSource<AllRichTextOptions>;
  options?: SerializedRichTextOptions;
}) {
  const beforeRemirror = richTextToRemirror(before);
  const afterRemirror = richTextToRemirror(after);

  const { manager: beforeManager } = useRichTextEditor(beforeRemirror);
  const { manager: afterManager } = useRichTextEditor(afterRemirror);

  // Create states for both documents
  const beforeState = useMemo(
    () => beforeManager.createState({ content: beforeRemirror }),
    [beforeManager, beforeRemirror],
  );

  const afterState = useMemo(
    () => afterManager.createState({ content: afterRemirror }),
    [afterManager, afterRemirror],
  );

  // For now, show side-by-side comparison
  // TODO: Implement inline diff with prosemirror-changeset decorations
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <div className="text-xs font-semibold text-fg-secondary mb-2">
          Previous
        </div>
        <div className="text-sm rounded border border-border-secondary overflow-hidden">
          <ReadOnlyRichTextEditor
            manager={beforeManager}
            initialContent={beforeState}
            options={options}
          />
        </div>
      </div>
      <div>
        <div className="text-xs font-semibold text-fg-secondary mb-2">
          Current
        </div>
        <div className="text-sm rounded border border-border-secondary overflow-hidden">
          <ReadOnlyRichTextEditor
            manager={afterManager}
            initialContent={afterState}
            options={options}
          />
        </div>
      </div>
    </div>
  );
}
