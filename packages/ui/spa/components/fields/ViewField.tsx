import {
  ModuleFilePath,
  SerializedViewSchema,
  SourcePath,
} from "@valbuild/core";
import { createContext, useContext, useMemo } from "react";
import { AnyField } from "../AnyField";
import { useSchemaAtPath } from "../ValFieldProvider";
import { FieldLoading } from "../FieldLoading";
import { FieldNotFound } from "../FieldNotFound";
import { FieldSchemaError } from "../FieldSchemaError";
import { prettyModuleName } from "../MediaPicker/GalleryUploadTarget";

/**
 * The modules this subtree is already inside a view of.
 *
 * A view renders another module's fields, which may themselves contain a view —
 * so `A → B → A` is a render loop, not merely bad content. Nothing server-side
 * catches it: with no source there is no data cycle, so `val validate` and every
 * source walk stay happy while the browser recurses until it dies.
 *
 * This is the RENDER backstop, not the rule. The rule is the schema-level cycle
 * check that reports a cycle as a validation error; this stops the tab locking
 * up while a developer still has the bad schema on disk.
 */
const ViewedModules = createContext<readonly ModuleFilePath[]>([]);

/**
 * A field that shows ANOTHER module.
 *
 * `path` is where the field sits in THIS module, and it is used for nothing but
 * the DOM id: a view stores no source, so there is nothing to read there. The
 * content, its patches, its validation errors and its previews are all resolved
 * against the TARGET module's own path — which is what makes this cheap. Every
 * field addresses the store by absolute `SourcePath`, so an edit made here is
 * an ordinary edit of the target module, with no cross-module plumbing at all.
 */
export function ViewField({
  path,
  schema,
  readonly,
  compact,
}: {
  path: SourcePath;
  schema: SerializedViewSchema;
  readonly?: boolean;
  compact?: boolean;
}) {
  const target = schema.moduleFilePath;
  const viewed = useContext(ViewedModules);
  const nextViewed = useMemo<readonly ModuleFilePath[]>(
    () => [...viewed, target],
    [viewed, target],
  );
  const isCycle = viewed.includes(target);
  const targetPath = target as unknown as SourcePath;
  // Before any early return: a hook below one is a hook-order trap — see
  // `architecture/quirks.md`.
  const targetSchema = useSchemaAtPath(targetPath);
  if (isCycle) {
    return (
      <FieldSchemaError
        path={path}
        type="view"
        error={`Cycle: ${[...viewed, target].map(prettyModuleName).join(" → ")}. A view may not contain a view of a module it is already inside.`}
      />
    );
  }
  if (targetSchema.status === "error") {
    return (
      <FieldSchemaError path={path} error={targetSchema.error} type="view" />
    );
  }
  if (targetSchema.status === "not-found") {
    return <FieldNotFound path={targetPath} type="view" />;
  }
  if (targetSchema.status === "loading") {
    return <FieldLoading path={targetPath} type="view" />;
  }
  return (
    <ViewedModules.Provider value={nextViewed}>
      <div id={path} className="flex flex-col gap-2">
        <div className="text-xs text-text-quartenary">
          {schema.editable ? "Editing" : "From"} {prettyModuleName(target)}
        </div>
        <AnyField
          path={targetPath}
          schema={targetSchema.data}
          readonly={readonly || !schema.editable}
          compact={compact}
        />
      </div>
    </ViewedModules.Provider>
  );
}
