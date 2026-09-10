import { SerializedSchema, SourcePath } from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import { Plus } from "lucide-react";
import { Button } from "./designSystem/button";
import { useAddPatch } from "./ValFieldProvider";
import { useEmptyOf } from "../hooks/useEmptyOf";
import { useParent } from "../hooks/useParent";

/**
 * A value that has not been written yet.
 *
 * `Field` already has this state — the checkbox beside a field's label, which
 * is offered whenever the source is `null` and not merely when the schema is
 * `.nullable()`. This is the same state for the places that render a value
 * WITHOUT that wrapper: the module editor, which is what you get by navigating
 * to a record entry, and the canvas' field column.
 *
 * Those places used to render the item schema's children over a `null` source,
 * so every child resolved to nothing and said "Not Found" — a list of broken
 * fields where the truth is one fact about the parent. A `null` value has no
 * children by definition; the only thing to offer is creating it.
 *
 * ## Why this is not about declared keys
 *
 * A locale-keyed record's unwritten entries are `null` (see
 * `schema/declaredKeys.ts`), which is what made this visible — but nothing here
 * asks about that. "Do not render children of a null source" holds for a
 * `.nullable()` object, for a record entry, and for a value that is `null`
 * against a schema that does not allow it. The declared-key rule stays in the
 * one place that states it, and the renderer needs no new knowledge.
 */
export function FieldNull({
  path,
  schema,
  readonly,
}: {
  path: SourcePath;
  schema: SerializedSchema;
  readonly?: boolean;
}) {
  const { patchPath, addPatch } = useAddPatch(path);
  const emptyOf = useEmptyOf();
  const { path: parentPath, schema: parentSchema } = useParent(path);
  /**
   * An entry of a locale-keyed record is not "empty", it is UNTRANSLATED — and
   * that is the state the locale work exists to make visible, so it is worth
   * saying in the words the editor is thinking in.
   *
   * Read off the parent record's key schema, which is the same fact
   * `RecordFields` reads for `keyDecidesLocale`. A locale scope may not contain
   * another, so there is no deeper case to consider: either the immediate
   * parent is that record or this is an ordinary empty value.
   */
  const isUntranslated =
    parentPath !== path &&
    parentSchema?.type === "record" &&
    parentSchema.key?.type === "locale";
  return (
    <div
      id={path}
      className="flex flex-col items-start gap-3 rounded-lg border border-border-primary border-dashed p-6"
    >
      <div className="flex flex-col gap-1">
        <div className="text-sm text-fg-primary">
          {isUntranslated ? "Not translated yet" : "Nothing here yet"}
        </div>
        <div className="text-sm text-fg-tertiary">
          {isUntranslated
            ? "This language is declared by the schema, and nobody has written it."
            : "This value has not been created."}
        </div>
      </div>
      {!readonly && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            addPatch(
              [
                {
                  op: "replace",
                  path: patchPath,
                  // `opt` stripped, the same way `Field`'s checkbox does it:
                  // the point of pressing this is to get a value, and
                  // `emptyOf` of an optional schema is `null`.
                  value: emptyOf({ ...schema, opt: false }) as JSONValue,
                },
              ],
              schema.type,
            );
          }}
        >
          <Plus size={14} className="mr-1" />
          {isUntranslated ? "Write this translation" : "Create"}
        </Button>
      )}
    </div>
  );
}
