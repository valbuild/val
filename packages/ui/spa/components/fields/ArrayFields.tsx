import { SourcePath, SerializedArraySchema } from "@valbuild/core";
import {
  useAddPatch,
  usePreviewOverrideAtPath,
  useSchemaAtPath,
  useShallowSourceAtPath,
} from "../ValProvider";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { FieldSourceError } from "../../components/FieldSourceError";
import { useNavigation } from "../../components/ValRouter";
import { SortableList } from "../../components/SortableList";
import { array } from "@valbuild/core/fp";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { ValidationErrors } from "../../components/ValidationError";
import { PreviewError } from "../PreviewError";
import { Loader2 } from "lucide-react";

export function ArrayFields({ path }: { path: SourcePath }) {
  const type = "array";
  const { navigate } = useNavigation();
  const schemaAtPath = useSchemaAtPath(path);
  const previewAtPath = usePreviewOverrideAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const { addPatch, patchPath } = useAddPatch(path);

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
  if (schemaAtPath.data.type !== "array") {
    return (
      <FieldSchemaMismatchError
        path={path}
        expectedType="array"
        actualType={schemaAtPath.data.type}
      />
    );
  }
  const schema = schemaAtPath.data as SerializedArraySchema;
  const previewAtPathData =
    previewAtPath && "data" in previewAtPath ? previewAtPath.data : undefined;

  // NOTE: we do not really want to show loading here, but since
  // preview data is loaded from the server,
  // we have a rather jarring UX of items rearranging when it finally finishes
  // Ideally this is less jarring, but for now we just show a loading spinner
  // which we figured was better than not doing so
  const loading =
    previewAtPathData &&
    ((sourceAtPath.status === "success" && sourceAtPath.clientSideOnly) ||
      sourceAtPath.status === "loading");
  return (
    <div id={path} className="relative w-full">
      <ValidationErrors path={path} />
      {previewAtPath?.status === "error" && (
        <PreviewError error={previewAtPath.message} path={path} />
      )}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-bg-disabled z-[40] opacity-40">
          <Loader2 className="animate-spin" />
        </div>
      )}
      <SortableList
        path={path}
        disabled={loading}
        onClick={(path) => {
          navigate(path);
        }}
        onDelete={async (item) => {
          addPatch(
            [
              {
                op: "remove",
                path: patchPath.concat(
                  item.toString(),
                ) as array.NonEmptyArray<string>,
              },
            ],
            schema.type,
          );
        }}
        onMove={async (from, to) => {
          addPatch(
            [
              {
                op: "move",
                from: patchPath.concat(
                  from.toString(),
                ) as array.NonEmptyArray<string>,
                path: patchPath.concat(to.toString()),
              },
            ],
            schema.type,
          );
        }}
        schema={schema}
        preview={
          previewAtPathData?.layout === "list" &&
          previewAtPathData.parent === "array"
            ? previewAtPathData
            : undefined
        }
        source={sourceAtPath.data || []}
      />
    </div>
  );
}

export function ArrayPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "array");
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError path={path} error={sourceAtPath.error} type="array" />
    );
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  return <div>{`${sourceAtPath.data.length} items`}</div>;
}
