import { SourcePath, ArraySchema, ObjectSchema } from "@valbuild/core";
import { Module } from "../components/Module";
import { Field } from "../components/Field";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";
import { useSchemaAtPath, useShallowSourceAtPath } from "../ValProvider";
import { FieldLoading } from "../components/FieldLoading";
import { FieldNotFound } from "../components/FieldNotFound";
import { FieldSchemaError } from "../components/FieldSchemaError";
import { FieldSchemaMismatchError } from "../components/FieldSchemaMismatchError";
import { FieldSourceError } from "../components/FieldSourceError";
import { useNavigation } from "../../components/ValRouter";

export function ArrayFields({ path }: { path: SourcePath }) {
  const type = "array";
  const { navigate } = useNavigation();
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
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
  if (schemaAtPath.data.type !== "array") {
    return (
      <FieldSchemaMismatchError
        path={path}
        expectedType="array"
        actualType={schemaAtPath.data.type}
      />
    );
  }
  const source = sourceAtPath.data;
  return (
    <>
      {source?.map((item, index) => {
        const subPath = sourcePathOfItem(path, index);
        return (
          <button
            key={subPath}
            onClick={() => {
              navigate(subPath);
            }}
          >
            GOTO: {subPath}
          </button>
        );
      })}
    </>
  );
}

export function ListPreview({ source }: { source: any }) {
  return <div>{`${source.length} items`}</div>;
}
