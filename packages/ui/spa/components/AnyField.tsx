import { SourcePath, SerializedSchema } from "@valbuild/core";
import { ArrayFields } from "./fields/ArrayFields";
import { BooleanField } from "./fields/BooleanField";
import { ImageField } from "./fields/ImageField";
import { KeyOfField } from "./fields/KeyOfField";
import { NumberField } from "./fields/NumberField";
import { ObjectFields } from "./fields/ObjectFields";
import { RecordFields } from "./fields/RecordFields";
import { RichTextField } from "./fields/RichTextField";
import { RouteField } from "./fields/RouteField";
import { StringField } from "./fields/StringField";
import { UnionField } from "./fields/UnionField";
import { DateField } from "./fields/DateField";
import { DateTimeField } from "./fields/DateTimeField";
import { FieldSchemaError } from "./FieldSchemaError";
import { FileField } from "./fields/FileField";
import { FieldValidationErrorCompact } from "./FieldValidationError";

export type ErrorDisplay = "default" | "compact" | "none";

export function AnyField({
  path,
  schema,
  autoFocus,
  readonly,
  compact,
  inline,
  hideUpload,
  errorDisplay = "default",
}: {
  path: SourcePath;
  schema: SerializedSchema;
  autoFocus?: boolean;
  readonly?: boolean;
  compact?: boolean;
  inline?: boolean;
  hideUpload?: boolean;
  errorDisplay?: ErrorDisplay;
}) {
  if (schema.hidden) {
    return null;
  }
  const effectiveReadonly = readonly || schema.readonly;
  const leafProps = { readonly: effectiveReadonly, compact };
  let leaf: React.ReactNode;
  if (schema.type === "string") {
    leaf = (
      <StringField
        key={path}
        path={path}
        autoFocus={autoFocus}
        {...leafProps}
      />
    );
  } else if (schema.type === "number") {
    leaf = <NumberField key={path} path={path} {...leafProps} />;
  } else if (schema.type === "boolean") {
    leaf = <BooleanField key={path} path={path} {...leafProps} />;
  } else if (schema.type === "image") {
    leaf = (
      <ImageField
        key={path}
        path={path}
        {...leafProps}
        hideUpload={hideUpload}
      />
    );
  } else if (schema.type === "object") {
    return (
      <ObjectFields
        key={path}
        path={path}
        readonly={effectiveReadonly}
        compact={compact}
        inline={inline}
        errorDisplay={errorDisplay}
      />
    );
  } else if (schema.type === "array") {
    return (
      <ArrayFields
        key={path}
        path={path}
        readonly={effectiveReadonly}
        compact={compact}
        inline={inline}
        errorDisplay={errorDisplay}
      />
    );
  } else if (schema.type === "record") {
    return (
      <RecordFields
        key={path}
        path={path}
        readonly={effectiveReadonly}
        compact={compact}
        inline={inline}
        errorDisplay={errorDisplay}
      />
    );
  } else if (schema.type === "union") {
    return (
      <UnionField
        key={path}
        path={path}
        readonly={effectiveReadonly}
        compact={compact}
        inline={inline}
        errorDisplay={errorDisplay}
      />
    );
  } else if (schema.type === "keyOf") {
    leaf = <KeyOfField key={path} path={path} {...leafProps} />;
  } else if (schema.type === "route") {
    leaf = <RouteField key={path} path={path} {...leafProps} />;
  } else if (schema.type === "richtext") {
    leaf = (
      <RichTextField
        key={path}
        path={path}
        autoFocus={autoFocus}
        {...leafProps}
      />
    );
  } else if (schema.type === "date") {
    leaf = <DateField key={path} path={path} {...leafProps} />;
  } else if (schema.type === "dateTime") {
    leaf = <DateTimeField key={path} path={path} {...leafProps} />;
  } else if (schema.type === "file") {
    leaf = <FileField key={path} path={path} {...leafProps} />;
  } else if (schema.type === "literal") {
    leaf = (
      <FieldSchemaError path={path} error="Literal fields are not editable" />
    );
  } else {
    const exhaustiveCheck: never = schema;
    leaf = (
      <FieldSchemaError
        path={path}
        error={"Unexpected field schema: " + JSON.stringify(exhaustiveCheck)}
      />
    );
  }

  if (errorDisplay === "compact") {
    return (
      <div className="flex items-stretch gap-1 min-w-0">
        <div className="flex-1 min-w-0">{leaf}</div>
        <div className="flex items-center px-1">
          <FieldValidationErrorCompact path={path} />
        </div>
      </div>
    );
  }
  return <>{leaf}</>;
}
