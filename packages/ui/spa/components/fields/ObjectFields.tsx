import { SerializedSchema, SourcePath } from "@valbuild/core";
import { Field } from "../../components/Field";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { useSchemaAtPath, useShallowSourceAtPath } from "../ValProvider";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { AnyField } from "../../components/AnyField";
import { Preview } from "../../components/Preview";
import { FieldSourceError } from "../../components/FieldSourceError";
import { fixCapitalization } from "../../utils/fixCapitalization";
import { ValidationErrors } from "../../components/ValidationError";

export function ObjectFields({ path }: { path: SourcePath }) {
  const type = "object";
  const schemaAtPath = useSchemaAtPath(path);
  const sourceAtPath = useShallowSourceAtPath(path, type);
  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type={type} />
    );
  }
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError
        path={path}
        error={sourceAtPath.error}
        schema={schemaAtPath}
      />
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
    <div id={path}>
      <ValidationErrors path={path} />
      <div className="flex flex-col gap-6">
        {Object.entries(schema.items).map(([key, itemSchema]) => {
          const subPath = sourcePathOfItem(path, key);
          return (
            <Field
              key={subPath}
              label={key}
              path={subPath}
              type={itemSchema.type}
            >
              <AnyField key={subPath} path={subPath} schema={itemSchema} />
            </Field>
          );
        })}
      </div>
    </div>
  );
}

export function ObjectPreview({ path }: { path: SourcePath }) {
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
  return <ObjectLikePreview path={path} schema={schema} />;
}

export function ObjectLikePreview({
  path,
  schema,
}: {
  path: SourcePath;
  schema: { items: Record<string, SerializedSchema> };
}) {
  return (
    <div
      id={path}
      className="grid grid-cols-[min-content,1fr] text-left gap-2 text-xs"
    >
      {Object.keys(schema.items).map((key) => {
        const subPath = sourcePathOfItem(path, key);
        return (
          <PreviewField key={key} label={key}>
            <Preview path={subPath} />
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
      <span className="flex whitespace-nowrap text-fg-disabled">
        {fixCapitalization(label)}
      </span>
      {children}
    </>
  );
}
