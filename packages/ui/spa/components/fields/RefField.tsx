import {
  ModuleFilePath,
  SerializedRefSchema,
  SourcePath,
} from "@valbuild/core";
import { AnyField } from "../AnyField";
import { useSchemaAtPath } from "../ValFieldProvider";
import { FieldLoading } from "../FieldLoading";
import { FieldNotFound } from "../FieldNotFound";
import { FieldSchemaError } from "../FieldSchemaError";
import { prettyModuleName } from "../MediaPicker/GalleryUploadTarget";

/**
 * SPIKE. A field that shows ANOTHER module.
 *
 * `path` is where the field sits in THIS module, and it is used for nothing but
 * the DOM id: a ref stores no source, so there is nothing to read there. The
 * content, its patches, its validation errors and its previews are all resolved
 * against the TARGET module's own path — which is what makes this cheap. Every
 * field addresses the store by absolute `SourcePath`, so an edit made here is
 * an ordinary edit of the target module, with no cross-module plumbing at all.
 */
export function RefField({
  path,
  schema,
  readonly,
  compact,
}: {
  path: SourcePath;
  schema: SerializedRefSchema;
  readonly?: boolean;
  compact?: boolean;
}) {
  const targetPath = schema.moduleFilePath as unknown as SourcePath;
  const targetSchema = useSchemaAtPath(targetPath);
  if (targetSchema.status === "error") {
    return (
      <FieldSchemaError path={path} error={targetSchema.error} type="ref" />
    );
  }
  if (targetSchema.status === "not-found") {
    return <FieldNotFound path={targetPath} type="ref" />;
  }
  if (targetSchema.status === "loading") {
    return <FieldLoading path={targetPath} type="ref" />;
  }
  return (
    <div id={path} className="flex flex-col gap-2">
      <div className="text-xs text-text-quartenary">
        {schema.editable ? "Editing" : "From"}{" "}
        {prettyModuleName(schema.moduleFilePath as ModuleFilePath)}
      </div>
      <AnyField
        path={targetPath}
        schema={targetSchema.data}
        readonly={readonly || !schema.editable}
        compact={compact}
      />
    </div>
  );
}
