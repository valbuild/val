import { SourcePath } from "@valbuild/core";
import { useSchemaAtPath } from "../ValProvider";
import { FieldSchemaError } from "./FieldSchemaError";
import { FieldLoading } from "./FieldLoading";
import { FieldNotFound } from "./FieldNotFound";
import { AnyField } from "./AnyField";

export function Module({ path }: { path: SourcePath }) {
  const schemaAtPath = useSchemaAtPath(path);
  if (schemaAtPath.status === "loading") {
    return <FieldLoading path={path} type="module" />;
  }
  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type="module" />
    );
  }
  if (schemaAtPath.status === "not-found") {
    return <FieldNotFound path={path} type="module" />;
  }
  const schema = schemaAtPath.data;
  return (
    <div className="flex flex-col gap-6 py-10">
      <AnyField path={path} schema={schema} />
    </div>
  );
}
