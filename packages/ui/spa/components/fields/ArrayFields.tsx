import {
  SourcePath,
  SerializedArraySchema,
  isInlineRender,
} from "@valbuild/core";
import {
  usePreviewAtPath,
  useShallowSourceAtPath,
  useSourceAtPath,
  useValField,
} from "../ValFieldProvider";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSchemaError } from "../../components/FieldSchemaError";
import { FieldSchemaMismatchError } from "../../components/FieldSchemaMismatchError";
import { FieldSourceError } from "../../components/FieldSourceError";
import { useNavigation } from "../../components/ValRouter";
import { SortableList, SortableContainer } from "../../components/SortableList";
import { BlockList } from "../../components/BlockList";
import { array } from "@valbuild/core/fp";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { PreviewError } from "../PreviewError";
import { Loader2 } from "lucide-react";
import { Field } from "../../components/Field";
import { AnyField } from "../../components/AnyField";
import { InlineSortableItem } from "../../components/InlineSortableItem";

export function ArrayFields({
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
  const type = "array";
  const { navigate } = useNavigation();
  const previewAtPath = usePreviewAtPath(path);
  const sourceAtPath = useSourceAtPath(path);
  /**
   * `watchUnsaved`, unlike almost every other field.
   *
   * A list has no caret to lose, and an indicator that says "saving" after the
   * save has landed is a visible lie — so this one is allowed to wake the
   * component. It is also load-bearing: the drag handle is a `<button disabled>`
   * driven by this answer, so a value frozen at the moment of the drag disables
   * reordering until something unrelated moves.
   */
  const {
    source: shallowSourceAtPath,
    schema: schemaAtPath,
    addPatch,
    patchPath,
    hasUnsavedOwnEdit,
  } = useValField(path, type, { watchUnsaved: true });

  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type={type} />
    );
  }
  if (shallowSourceAtPath.status === "error") {
    return (
      <FieldSourceError
        path={path}
        error={shallowSourceAtPath.error}
        schema={schemaAtPath}
      />
    );
  }
  if (
    shallowSourceAtPath.status == "not-found" ||
    schemaAtPath.status === "not-found"
  ) {
    return <FieldNotFound path={path} type={type} />;
  }
  if (schemaAtPath.status === "loading") {
    return <FieldLoading path={path} type={type} />;
  }
  if (schemaAtPath.data.type !== "array") {
    return (
      <FieldSchemaMismatchError
        path={path}
        expectedType="array"
        actualType={schemaAtPath.data.type}
      />
    );
  }
  const schema = schemaAtPath.data as SerializedArraySchema;
  const previewAtPathData =
    previewAtPath && "data" in previewAtPath ? previewAtPath.data : undefined;

  /**
   * Is there an edit of ours the server has not acknowledged yet?
   *
   * Shown, never enforced. This used to gate `disabled` on the list, its rows,
   * and the delete and duplicate buttons, behind a blocking overlay — so making
   * one edit took the controls away until the next one. Two things were wrong
   * with it:
   *
   * - `clientSideOnly` was stale (see `useHasUnsavedFrom`), so "until the next
   *   one" meant "until some unrelated change moved source at this path", which
   *   in practice was never. One drag disabled dragging.
   * - Even fixed, it is the wrong rule. An unsaved edit of your own is the normal
   *   state of the editor, and the whole per-instance suppression design exists
   *   so that your own edit is not news to you. It must not block you either.
   *
   * The overlay was a curtain over previews recomputing after a reorder. That is
   * worth solving by not moving the rows out from under the reader — see
   * `SortableContainer` — rather than by disabling the control that caused it.
   */
  const savingOwnEdit =
    previewAtPathData !== undefined &&
    (hasUnsavedOwnEdit || shallowSourceAtPath.status === "loading");
  /**
   * An inline item schema picks the list, and it does so BEFORE the `inline`
   * prop below and before anything to do with `preview`.
   *
   * `render` and `preview` answer different questions (see
   * `architecture/render-and-preview.md`), and where they both have something
   * to say about a list row, the render wins: `.render({ as: "inline" })` is
   * the author saying "this is edited here", and a `.preview(...)` on the same
   * schema then describes the value for the places it is only referred to — a
   * search hit, a reference, the collapsed header of its own row — not for the
   * field itself.
   */
  if (isInlineRender(schema.item)) {
    return (
      <div className="relative w-full">
        {previewAtPath?.status === "error" && (
          <PreviewError error={previewAtPath.message} path={path} />
        )}
        <BlockList path={path} readonly={readonly} />
      </div>
    );
  }
  if (inline) {
    const sourcePaths = shallowSourceAtPath.data as SourcePath[] | null;
    if (sourcePaths === null) {
      return null;
    }
    return (
      <div id={path}>
        <SortableContainer
          source={sourcePaths}
          disabled={readonly}
          onMove={(from, to) => {
            addPatch(
              [
                {
                  op: "move",
                  from: patchPath.concat(
                    from.toString(),
                  ) as array.NonEmptyArray<string>,
                  path: patchPath.concat(to.toString()),
                },
              ],
              schema.type,
            );
          }}
          className={`flex flex-col ${compact ? "gap-3" : "gap-4"}`}
          renderItem={({ path: itemPath, id }) => {
            if (schema.item.hidden) {
              return null;
            }
            return (
              <InlineSortableItem id={id} disabled={readonly}>
                <Field
                  path={itemPath}
                  type={schema.item.type}
                  readonly={readonly || schema.item.readonly}
                  compact={compact}
                  errorDisplay={errorDisplay}
                >
                  <AnyField
                    path={itemPath}
                    schema={schema.item}
                    readonly={readonly || schema.item.readonly}
                    compact={compact}
                    inline={inline}
                    errorDisplay={errorDisplay}
                  />
                </Field>
              </InlineSortableItem>
            );
          }}
        />
      </div>
    );
  }
  return (
    <div id={path} className="relative w-full">
      {previewAtPath?.status === "error" && (
        <PreviewError error={previewAtPath.message} path={path} />
      )}
      {savingOwnEdit && (
        // `pointer-events-none` is the whole point: it says something is in
        // flight without standing between the reader and the list.
        <div className="pointer-events-none absolute right-2 top-2 z-[40] flex items-center text-fg-secondary">
          <Loader2 className="animate-spin h-4 w-4" />
        </div>
      )}
      <SortableList
        path={path}
        disabled={readonly}
        onClick={(path) => {
          navigate(path);
        }}
        onDelete={async (item) => {
          addPatch(
            [
              {
                op: "remove",
                path: patchPath.concat(
                  item.toString(),
                ) as array.NonEmptyArray<string>,
              },
            ],
            schema.type,
          );
        }}
        onDuplicate={async (item) => {
          if (
            "data" in sourceAtPath &&
            sourceAtPath.data &&
            Array.isArray(sourceAtPath.data)
          ) {
            addPatch(
              [
                {
                  op: "add",
                  path: patchPath.concat(item.toString()),
                  value: sourceAtPath.data?.[item] ?? null,
                },
              ],
              schema.type,
            );
          }
        }}
        onMove={async (from, to) => {
          addPatch(
            [
              {
                op: "move",
                from: patchPath.concat(
                  from.toString(),
                ) as array.NonEmptyArray<string>,
                path: patchPath.concat(to.toString()),
              },
            ],
            schema.type,
          );
        }}
        source={shallowSourceAtPath.data || []}
      />
    </div>
  );
}

export function ArrayPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "array");
  if (sourceAtPath.status === "error") {
    return <FieldSourceError path={path} error={sourceAtPath.error} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  return <div>{`${sourceAtPath.data.length} items`}</div>;
}
