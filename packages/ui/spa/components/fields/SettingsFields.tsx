import { SourcePath } from "@valbuild/core";
import { Field } from "../../components/Field";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSourceError } from "../../components/FieldSourceError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { useSchemaAtPath, useShallowSourceAtPath } from "../ValFieldProvider";
import { AnyField } from "../../components/AnyField";
import { ObjectLikePreview } from "./ObjectFields";
import { fixCapitalization } from "../../utils/fixCapitalization";

/**
 * The generic editor for `s.settings()` and its sections.
 *
 * Not where settings are normally edited — that is the Settings panel, which
 * has a UI built for each field. This is the fallback for anything that
 * navigates to a settings path anyway (a validation error, a link) and it must
 * not be the thing that decides how settings look.
 *
 * The difference from {@link ObjectFields} is which keys it renders: the ones
 * the SOURCE has, not the ones the schema declares. Every settings key is
 * optional, so a section the project has not set is unset — not missing — and
 * rendering it as a row of "not found" fields would report as broken exactly
 * the state that `{}` is supposed to be.
 */
export function SettingsFields({
  path,
  readonly,
  compact,
  inline,
  errorDisplay = "default",
}: {
  path: SourcePath;
  readonly?: boolean;
  compact?: boolean;
  inline?: boolean;
  errorDisplay?: "default" | "compact" | "none";
}) {
  const type = "settings";
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
    sourceAtPath.status === "not-found" ||
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
  const source = sourceAtPath.data;
  return (
    <div id={path}>
      <div className={`flex flex-col ${compact ? "gap-3" : "gap-6"}`}>
        {Object.entries(schema.items).map(([key, itemSchema]) => {
          if (itemSchema.hidden) {
            return null;
          }
          if (source === null || !(key in source)) {
            return null;
          }
          const subPath = sourcePathOfItem(path, key);
          const itemReadonly = readonly || itemSchema.readonly;
          return (
            <Field
              key={subPath}
              label={fixCapitalization(key)}
              description={itemSchema.description}
              path={subPath}
              type={itemSchema.type}
              readonly={itemReadonly}
              compact={compact}
              errorDisplay={errorDisplay}
            >
              <AnyField
                key={subPath}
                path={subPath}
                schema={itemSchema}
                readonly={itemReadonly}
                compact={compact}
                inline={inline}
                errorDisplay={errorDisplay}
              />
            </Field>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A settings module as a preview row — which is what the publish diff shows for
 * it. Its sections list the way an object's keys do; see
 * {@link ObjectLikePreview}.
 */
export function SettingsPreview({
  path,
  size,
}: {
  path: SourcePath;
  size?: "compact";
}) {
  const type = "settings";
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
  if (schemaAtPath.data.type !== type) {
    return (
      <FieldSchemaMismatchError
        path={path}
        expectedType={type}
        actualType={schemaAtPath.data.type}
      />
    );
  }
  return (
    <ObjectLikePreview path={path} schema={schemaAtPath.data} size={size} />
  );
}
