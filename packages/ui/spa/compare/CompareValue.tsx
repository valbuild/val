import { useMemo } from "react";
import { Internal, type SourcePath } from "@valbuild/core";
import { AnyField } from "../components/AnyField";
import {
  FieldSourceOverrideContext,
  useSchemaAtPath,
  useServerSourceAtPath,
} from "../components/ValFieldProvider";
import type { SourceOverride } from "../components/ValFieldProvider";

/**
 * One path's value, on one side of the comparison.
 *
 * Read-only, without exception. A field here is the RESULT of a chain of patch
 * sets, each with its own author and its own undo control, so an edit made in
 * it would belong to none of them and land as yet another patch on top — while
 * the row it was typed into went on describing the change it used to describe.
 * `ComparePatchSets` learned that the hard way; see its header.
 *
 * No rails and no strike-through: the pane draws those, per side, because it
 * is the thing that knows which column this is in and whether the row is a
 * move (where both sides are the same value and a rail would claim an edit
 * that did not happen).
 */
export function CompareValue({
  path,
  side,
}: {
  path: SourcePath;
  /**
   * `before` renders against the module's BASE source rather than the store's.
   *
   * Through `FieldSourceOverrideContext`, which is what that context is for:
   * reading the store on both sides shows the patched value twice, which is a
   * diff that always looks empty.
   */
  side: "before" | "after";
}) {
  if (side === "before") {
    return <BeforeValue path={path} />;
  }
  return <Value path={path} />;
}

function BeforeValue({ path }: { path: SourcePath }) {
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  /*
   * The MODULE's base source, not the path's.
   *
   * `SourceOverride` replaces the whole module for anything reading below it,
   * so what it wants is the module. Handed the value at `path` instead, the
   * override is a string where a module's source object should be, every
   * field under it resolves to nothing, and the before column comes out empty
   * — which reads as "there was nothing here" rather than as a bug.
   */
  const base = useServerSourceAtPath(moduleFilePath);
  const override = useMemo<SourceOverride | null>(
    () =>
      base.status === "success"
        ? { moduleFilePath, moduleSource: base.data }
        : null,
    [moduleFilePath, base],
  );
  /*
   * Nothing at all while the base is still arriving, rather than the patched
   * value. A "before" that is momentarily the "after" is a diff that reads as
   * empty, and an empty diff is indistinguishable from a change that was
   * already undone.
   */
  if (override === null) return null;
  return (
    <FieldSourceOverrideContext.Provider value={override}>
      <Value path={path} />
    </FieldSourceOverrideContext.Provider>
  );
}

function Value({ path }: { path: SourcePath }) {
  const schemaAtPath = useSchemaAtPath(path);
  if (schemaAtPath.status !== "success") return null;
  return (
    <AnyField
      path={path}
      schema={schemaAtPath.data}
      readonly
      compact
      inline
      hideUpload
      errorDisplay="none"
    />
  );
}
