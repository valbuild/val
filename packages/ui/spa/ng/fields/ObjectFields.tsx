import { SourcePath } from "@valbuild/core";
import { StringField } from "../fields/StringField";
import { NumberField } from "../fields/NumberField";
import { BooleanField } from "../fields/BooleanField";
import { ArrayFields } from "./ArrayFields";
import { KeyOfField } from "./KeyOfField";
import { ImageField } from "./ImageField";
import { UnionField } from "./UnionField";
import { RichTextField } from "./RichTextField";
import { Field } from "../components/Field";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";
import { FieldLoading } from "../components/FieldLoading";
import { FieldNotFound } from "../components/FieldNotFound";
import { FieldSchemaError } from "../components/FieldSchemaError";
import { useSchemaAtPath } from "../ValProvider";
import { FieldSchemaMismatchError } from "../components/FieldSchemaMismatchError";

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
    switch (itemSchema.type) {
      case "string":
        return (
          <Field key={key} label={label} path={subPath}>
            <StringField path={subPath} />
          </Field>
        );
      case "number":
        return (
          <Field key={key} label={label} path={subPath}>
            <NumberField path={subPath} />
          </Field>
        );
      case "boolean":
        return (
          <Field key={key} label={label} path={subPath}>
            <BooleanField path={subPath} />
          </Field>
        );
      case "image":
        return (
          <Field key={key} label={label} path={subPath}>
            <ImageField path={subPath} />
          </Field>
        );
      case "array":
        return (
          <Field
            key={key}
            label={label}
            path={subPath}
            transparent
            foldLevel="2"
          >
            <ArrayFields path={subPath} />
          </Field>
        );
      case "keyOf":
        return (
          <Field key={key} label={label} path={subPath}>
            <KeyOfField path={subPath} />
          </Field>
        );
      case "union":
        return (
          <Field key={key} label={label} path={subPath}>
            <UnionField path={subPath} />
          </Field>
        );
      case "object":
        return (
          <Field
            key={key}
            label={label}
            path={subPath}
            transparent
            foldLevel="2"
          >
            <ObjectFields path={subPath} />
          </Field>
        );
      case "richtext":
        return (
          <Field key={key} label={label} path={subPath}>
            <RichTextField path={subPath} />
          </Field>
        );
      default: {
        const exhaustiveCheck: never = itemSchema.type;
        return (
          <Field key={key} label={label} path={subPath}>
            <div>Unknown schema</div>
          </Field>
        );
      }
    }
  });
}
