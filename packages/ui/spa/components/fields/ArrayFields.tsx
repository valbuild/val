import { SourcePath, SerializedArraySchema } from "@valbuild/core";
import {
  useAddPatch,
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

export function ArrayFields({ path }: { path: SourcePath }) {
  const type = "array";
  const { navigate } = useNavigation();
  const schemaAtPath = useSchemaAtPath(path);
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
  return (
    <div>
      <ValidationErrors path={path} />
      <SortableList
        path={path}
        onClick={(path) => {
          navigate(path);
        }}
        onDelete={async (item) => {
          addPatch([
            {
              op: "remove",
              path: patchPath.concat(
                item.toString(),
              ) as array.NonEmptyArray<string>,
            },
          ]);
        }}
        onMove={async (from, to) => {
          addPatch([
            {
              op: "move",
              from: patchPath.concat(
                from.toString(),
              ) as array.NonEmptyArray<string>,
              path: patchPath.concat(to.toString()),
            },
          ]);
        }}
        schema={schema}
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
