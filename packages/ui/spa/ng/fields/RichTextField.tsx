import { SourcePath } from "@valbuild/core";
import { FieldLoading } from "../components/FieldLoading";
import { FieldNotFound } from "../components/FieldNotFound";
import { FieldSchemaError } from "../components/FieldSchemaError";
import { FieldSourceError } from "../components/FieldSourceError";
import {
  useSchemaAtPath,
  useShallowSourceAtPath,
  useAddPatch,
} from "../ValProvider";
import {
  RichTextEditor,
  useRichTextEditor,
} from "../../components/fields/RichTextEditor";
import {
  RemirrorJSON,
  remirrorToRichTextSource,
  richTextToRemirror,
} from "@valbuild/shared/internal";
import { FieldSchemaMismatchError } from "../components/FieldSchemaMismatchError";

export function RichTextField({ path }: { path: SourcePath }) {
  const type = "richtext";
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const defaultValue: RemirrorJSON | undefined =
    "data" in sourceAtPath ? sourceAtPath.data : undefined;
  const { state, manager } = useRichTextEditor(
    defaultValue && richTextToRemirror(defaultValue),
  );
  const [patchPath, addPatch] = useAddPatch(path);
  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type={type} />
    );
  }
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError path={path} error={sourceAtPath.error} type={type} />
    );
  }
  if (
    sourceAtPath.status == "not-found" ||
    schemaAtPath.status === "not-found"
  ) {
    return <FieldNotFound path={path} type={type} />;
  }
  if (schemaAtPath.status === "loading") {
    return <FieldLoading path={path} type={type} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <FieldLoading path={path} type={type} />;
  }
  if (schemaAtPath.data.type !== type) {
    return (
      <FieldSchemaMismatchError
        path={path}
        expectedType={type}
        actualType={schemaAtPath.data.type}
      />
    );
  }
  const schema = schemaAtPath.data;

  return (
    <RichTextEditor
      options={schema.options}
      state={state}
      manager={manager}
      submitStatus={"idle"}
      onChange={(state) => {
        addPatch([
          {
            op: "replace",
            path: patchPath,
            value: remirrorToRichTextSource(state).blocks,
          },
        ]);
      }}
    />
  );
}
