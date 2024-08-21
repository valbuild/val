import { RemirrorJSON } from "@remirror/core";
import {
  SerializedRichTextSchema,
  RichTextSource,
  AllRichTextOptions,
} from "@valbuild/core";
import { Patch, Operation } from "@valbuild/core/patch";
import {
  richTextToRemirror,
  RemirrorJSON as ValidRemirrorJSON,
  remirrorToRichTextSource,
} from "@valbuild/shared/internal";
import { useState, useEffect } from "react";
import { useRichTextEditor, RichTextEditor } from "../../RichTextEditor";
import { OnSubmit, useBounceSubmit } from "../../SubmitStatus";
import { FieldContainer } from "../FieldContainer";

export function RichTextField({
  defaultValue,
  schema,
  onSubmit,
}: {
  onSubmit?: OnSubmit;
  schema: SerializedRichTextSchema;
  defaultValue?: RichTextSource<AllRichTextOptions>;
}) {
  const [didChange, setDidChange] = useState(false);
  const [content, setContent] = useState<RemirrorJSON>();
  useEffect(() => {
    setDidChange(false);
    setContent(undefined);
  }, [defaultValue]);
  const { state, manager } = useRichTextEditor(
    defaultValue && richTextToRemirror(defaultValue)
  );

  const submitStatus = useBounceSubmit<RemirrorJSON | undefined>(
    didChange,
    content,
    onSubmit,
    async (value, patchPath) => {
      if (!value) {
        return [];
      }
      const validRemirrorJSON = ValidRemirrorJSON.safeParse(content);
      if (validRemirrorJSON.success) {
        return createRichTextPatch(patchPath, validRemirrorJSON.data);
      } else {
        return [];
      }
    }
  );

  return (
    <FieldContainer>
      <RichTextEditor
        options={schema.options}
        onChange={(content) => {
          setDidChange(true);
          setContent(content);
        }}
        state={state}
        manager={manager}
        submitStatus={submitStatus}
      />
    </FieldContainer>
  );
}

function createRichTextPatch(
  path: string[],
  content?: ValidRemirrorJSON
): Patch {
  console.log("content", content);
  const { blocks, files } = content
    ? remirrorToRichTextSource(content)
    : {
        blocks: [],
        files: {},
      };
  console.log("blocks", blocks);
  return [
    {
      op: "replace" as const,
      path,
      value: blocks,
    },
    ...Object.entries(files).flatMap(([filePath, { value, patchPaths }]) => {
      return patchPaths.map(
        (patchPath): Operation => ({
          op: "file" as const,
          path,
          filePath,
          value,
          nestedFilePath: patchPath,
        })
      );
    }),
  ];
}
