import { RichTextSchema, SourcePath } from "@valbuild/core";
import {
  RichTextEditor,
  useRichTextEditor,
} from "../../components/fields/RichTextEditor";
import { richTextToRemirror } from "@valbuild/shared/internal";
import { NullSource } from "../components/NullSource";

export function RichTextField({
  path,
  source,
  schema,
}: {
  path: SourcePath;
  source: any;
  schema: RichTextSchema<Record<string, never>, null>;
}) {
  const defaultValue = source;
  const { state, manager } = useRichTextEditor(
    defaultValue && richTextToRemirror(defaultValue)
  );

  if (!source) {
    return <NullSource />;
  }

  return (
    <RichTextEditor
      options={schema.options}
      state={state}
      manager={manager}
      submitStatus={"idle"}
    />
  );
}
