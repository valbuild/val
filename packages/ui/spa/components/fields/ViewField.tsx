import { SerializedValViewSchema, SourcePath } from "@valbuild/core";
import { ChevronRight } from "lucide-react";
import {
  useModuleSchemaRemote,
  useShallowSourceAtPath,
} from "../ValFieldProvider";
import { useNavigation } from "../ValRouter";
import { FieldLoading } from "../FieldLoading";
import { FieldNotFound } from "../FieldNotFound";
import { FieldSourceError } from "../FieldSourceError";
import { prettyModuleName } from "../MediaPicker/GalleryUploadTarget";

/**
 * A row that takes the editor to ANOTHER module.
 *
 * A view holds a pointer and nothing else, so there is nothing here to edit:
 * this navigates to the target module, where the content is edited under its own
 * path, with its own breadcrumb — which is also what keeps an editor from
 * mistaking a shared module for a field of this page.
 *
 * The row reads the TARGET's schema for its description. It deliberately does
 * not read the target's source: a view is a link, and a link should not pull a
 * module's content into the page that links to it.
 *
 * Nor does it read the target's `hidden` or `readonly`. Those are the target
 * MODULE's, and they answer a different question — whether the Explorer lists
 * it, and whether an editor may change it once there. Whether this row exists
 * is the VIEW's own `hidden`, which `AnyField` has already applied by the time
 * this renders. A hidden module behind a shown view is the case the feature is
 * for: `employees.val.ts` is a `keyOf` target that does not belong in the nav,
 * and belongs on `/menneskene`.
 */
export function ViewField({
  path,
  schema,
}: {
  path: SourcePath;
  schema: SerializedValViewSchema;
}) {
  const type = "view";
  const { navigate } = useNavigation();
  const target = schema.moduleFilePath;
  const targetPath = target as unknown as SourcePath;
  const sourceAtPath = useShallowSourceAtPath(path, type);
  /*
   * The target's schema, by module path — NOT `useSchemaAtPath`.
   *
   * Resolving a schema against a source PATH needs the module's source, so
   * `useSchemaAtPath` peeks and demands it; for a `.jsonValues()` target that is
   * every entry of a record this row only links to. A view is a link, and a link
   * must not pull in what it links to, so this asks the schema store directly.
   */
  const targetSchema = useModuleSchemaRemote(target);
  if (sourceAtPath.status === "error") {
    return (
      /*
       * THIS field's schema, not the target's.
       *
       * The generic repair is `emptyOf(schema)`, and the empty value of a view
       * is the pointer itself — which is exactly the fix a malformed pointer
       * wants. Handing it the target's schema instead offered a Fix that wrote
       * an empty value of the TARGET's shape into this field.
       */
      <FieldSourceError
        path={path}
        error={sourceAtPath.error}
        schema={{ status: "success", data: schema }}
      />
    );
  }
  if (targetSchema.status === "not-found") {
    /*
     * The schema names a module the project does not have.
     *
     * Nothing else reports this: `executeValidate` checks the pointer against
     * the schema, and `viewCycleErrors` only looks for cycles — a target that is
     * not a module of the project is deliberately skipped there. So this row is
     * where an editor finds out, and `val validate` stays quiet about it. See
     * the follow-up in the changeset.
     */
    return <FieldNotFound path={targetPath} type={type} />;
  }
  if (targetSchema.status === "loading") {
    return <FieldLoading path={targetPath} type={type} />;
  }
  return (
    <div id={path}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border-primary p-3 text-left hover:bg-bg-secondary"
        onClick={() => {
          navigate(targetPath);
        }}
      >
        <span className="min-w-0">
          <span className="block truncate">{prettyModuleName(target)}</span>
          {targetSchema.data.description && (
            <span className="block truncate text-xs text-text-quartenary">
              {targetSchema.data.description}
            </span>
          )}
        </span>
        <ChevronRight size={16} className="shrink-0" />
      </button>
    </div>
  );
}
