import { Remirror, EditorComponent } from "@remirror/react";
import classNames from "classnames";
import { useMemo } from "react";
import { SerializedRichTextOptions } from "@valbuild/core";
import type {
  EditorState,
  RemirrorManager,
  AnyExtension,
} from "@remirror/core";

export function ReadOnlyRichTextEditor<E extends AnyExtension>({
  initialContent,
  state,
  manager,
}: {
  initialContent?: Readonly<EditorState>;
  state?: Readonly<EditorState>;
  manager: RemirrorManager<E>;
  options?: SerializedRichTextOptions;
}) {
  const remirrorClassNames = useMemo(() => {
    return [
      classNames(
        "p-3 outline-none focus:outline-none appearance-none bg-bg-tertiary text-fg-primary",
      ),
    ];
  }, []);

  return (
    <div
      className={classNames("relative text-sm val-rich-text-editor-readonly")}
    >
      <Remirror
        manager={manager}
        initialContent={initialContent}
        state={state}
        classNames={remirrorClassNames}
        editable={false}
      >
        <EditorComponent />
      </Remirror>
    </div>
  );
}
