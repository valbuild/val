import { SourcePath } from "@valbuild/core";
import { Field } from "../components/Field";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";
import { FieldLoading } from "../components/FieldLoading";
import { FieldNotFound } from "../components/FieldNotFound";
import { FieldSchemaError } from "../components/FieldSchemaError";
import { useSchemaAtPath, useShallowSourceAtPath } from "../ValProvider";
import { FieldSchemaMismatchError } from "../components/FieldSchemaMismatchError";
import { AnyField } from "../components/AnyField";
import { Preview, PreviewLoading, PreviewNull } from "../components/Preview";

export function ObjectFields({ path }: { path: SourcePath }) {
  const type = "object";
  const schemaAtPath = useSchemaAtPath(path);
  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type={type} />
    );
  }
  if (schemaAtPath.status === "loading") {
    return <FieldLoading path={path} type={type} />;
  }
  if (schemaAtPath.status === "not-found") {
    return <FieldNotFound path={path} type={type} />;
  }
  if (schemaAtPath.data.type !== "object") {
    return (
      <FieldSchemaMismatchError
        path={path}
        expectedType="object"
        actualType={schemaAtPath.data.type}
      />
    );
  }
  const schema = schemaAtPath.data;
  return Object.entries(schema.items).map(([label, itemSchema]) => {
    const key = JSON.stringify({ label, itemSchema });
    const subPath = sourcePathOfItem(path, label);
    return (
      <Field key={key} label={label} path={subPath}>
        <AnyField path={subPath} schema={itemSchema} />
      </Field>
    );
  });
}

export function ObjectPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "object");
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  return (
    <div className="grid grid-cols-[min-content,1fr] text-left gap-2 text-xs">
      {Object.entries(sourceAtPath.data).map(([key, fieldPath]) => {
        return (
          <PreviewField key={key} label={key}>
            <Preview path={fieldPath} />
          </PreviewField>
        );
      })}
    </div>
  );
}

function PreviewField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <span className="text-fg-brand-primary">{label}</span>
      {children}
    </>
  );
}
