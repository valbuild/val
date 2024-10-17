import { SourcePath } from "@valbuild/core";
import { Input } from "../../components/ui/input";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
} from "../ValProvider";
import { FieldLoading } from "../components/FieldLoading";
import { FieldNotFound } from "../components/FieldNotFound";
import { FieldSchemaError } from "../components/FieldSchemaError";
import { FieldSourceError } from "../components/FieldSourceError";
import { FieldSchemaMismatchError } from "../components/FieldSchemaMismatchError";
import { PreviewLoading, PreviewNull } from "../components/Preview";
import { useEffect } from "react";

export function StringField({ path }: { path: SourcePath }) {
  const type = "string";
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  const { patchPath, addDebouncedPatch } = useAddPatch(path);
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
  const source = sourceAtPath.data;
  return (
    <Input
      defaultValue={source || ""}
      onChange={(ev) => {
        addDebouncedPatch(
          () => [
            {
              op: "replace",
              path: patchPath,
              value: ev.target.value,
            },
          ],
          path,
        );
      }}
    />
  );
}

export function StringPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "string");
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  return <div className="truncate">{sourceAtPath.data}</div>;
}
