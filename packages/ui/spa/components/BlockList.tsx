import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronRight,
  Copy,
  EllipsisVertical,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Json,
  SerializedSchema,
  SerializedArraySchema,
  SerializedObjectUnionSchema,
  SerializedUnionSchema,
  SourcePath,
  isInlineRender,
} from "@valbuild/core";
import { array } from "@valbuild/core/fp";
import { JSONValue } from "@valbuild/core/patch";
import { useSourceAtPath, useValField } from "./ValFieldProvider";
import { useValidationErrors } from "./ValErrorProvider";
import { AnyField } from "./AnyField";
import {
  isObjectUnion,
  ObjectUnionTagSelect,
  useObjectUnion,
} from "./fields/UnionField";
import { RefPreview } from "./RefPreview";
import { useRefPreview } from "./useRefPreview";
import { useNavigation } from "./ValRouter";
import { useValPortal } from "./ValPortalProvider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./designSystem/popover";
import { cn } from "./designSystem/cn";
import { DRAG_HANDLE_TOUCH, SORTABLE_ROW_TOUCH } from "./dragHandle";

import { sourcePathOfItem } from "../utils/sourcePathOfItem";
import { FieldValidationError } from "./FieldValidationError";
import { useEmptyOf } from "../hooks/useEmptyOf";

/**
 * A rebuilt sortable list for arrays, dense enough that a page-builder tree —
 * lists of inline objects nested three levels deep — fits on a laptop screen.
 *
 * `ArrayFields` renders this whenever the list's ITEM schema is inline (see
 * `isInlineRender`) and `SortableList` otherwise, so a list of preview rows is
 * untouched by any of this.
 *
 * What it does differently from `SortableList`:
 * - An item whose schema declares `.render({ as: "inline" })` is EDITED IN
 *   PLACE inside its (sortable) row; anything else stays a clickable preview
 *   row. The decision reads straight off the serialized item schema.
 * - Object items get a compact header (grip, index, summary, collapse) and lay
 *   their fields out tightly; nested inline lists recurse with a thin
 *   indentation rail instead of another card-in-card.
 * - Leaf items (string, number, ...) are a single row: grip, the field, menu.
 *
 * The optimistic-permutation-reset in the dnd wiring is the same doctrine as
 * `SortableContainer` (see the long comment there): an array item's path is
 * positional, so the local permutation must be re-derived from source the
 * moment the move patch applies, or the move is applied twice and cancels out.
 */
/**
 * A density pass over the stock field controls, scoped to the list so nothing
 * outside it changes: the design-system `Input` is `h-10 m-1` and the rich text
 * editor `p-4`, which alone put a three-level tree far past one laptop screen.
 *
 * Descendant overrides, which is the part that should not last: these want to
 * be proper `compact` variants on the controls themselves. Until they are, a
 * control that changes its metrics changes them here too, silently.
 */
const DENSE_FIELDS = cn(
  "[&_input]:h-7 [&_input]:m-0 [&_input]:w-full [&_input]:px-2 [&_input]:py-1 [&_input]:text-[13px]",
  // The auto-growing textarea's height comes from its invisible ghost twin, so
  // the ghost needs the same metrics or the box stays sized for the old ones.
  // `field-sizing: content` stops the textarea's default `rows=2` from setting
  // the grid row's intrinsic height (Chromium; elsewhere it stays two rows).
  "[&_textarea]:min-h-0 [&_textarea]:m-0 [&_textarea]:px-2 [&_textarea]:py-1 [&_textarea]:text-[13px] [&_textarea]:leading-5 [&_textarea]:[field-sizing:content]",
  "[&_[data-testid=auto-growing-textarea-ghost]]:m-0 [&_[data-testid=auto-growing-textarea-ghost]]:px-2 [&_[data-testid=auto-growing-textarea-ghost]]:py-1 [&_[data-testid=auto-growing-textarea-ghost]]:text-[13px] [&_[data-testid=auto-growing-textarea-ghost]]:leading-5",
  // The rich text editor keeps its fixed toolbar (and the padding reserving
  // room for it) only while focused; at rest it is one tight paragraph box.
  "[&_.rich-text-editor:not(:focus-within)_.prose-editor]:p-2 [&_.rich-text-editor:not(:focus-within)_.prose-editor]:min-h-0",
  "[&_.rich-text-editor:not(:focus-within)>.absolute]:hidden",
  "[&_.prose-editor]:text-[13px]",
);

export function BlockList({
  path,
  readonly,
  depth = 0,
}: {
  path: SourcePath;
  readonly?: boolean;
  /** Nesting level, used only for layout (rail indentation). */
  depth?: number;
}) {
  const type = "array";
  const { navigate } = useNavigation();
  const emptyOf = useEmptyOf();
  const sourceAtPath = useSourceAtPath(path);
  const {
    source: shallowSourceAtPath,
    schema: schemaAtPath,
    addPatch,
    patchPath,
  } = useValField(path, type, { watchUnsaved: true });

  const [items, setItems] = useState<{ path: SourcePath; id: number }[]>([]);
  const sourcePaths =
    "data" in shallowSourceAtPath && shallowSourceAtPath.data
      ? (shallowSourceAtPath.data as SourcePath[])
      : null;
  useEffect(() => {
    // Re-derived from source on purpose — see the doc comment above.
    const nextItems: { path: SourcePath; id: number }[] = [];
    let id = 1; // 1-based: dnd-kit treats id 0 as "no active item"
    for (const itemPath of sourcePaths ?? []) {
      nextItems.push({ path: itemPath, id });
      id++;
    }
    setItems(nextItems);
  }, [sourcePaths]);

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const [activeId, setActiveId] = useState<number | null>(null);
  const activeItem =
    activeId !== null ? items.find((item) => item.id === activeId) : undefined;

  const onMove = useCallback(
    (from: number, to: number) => {
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
        type,
      );
    },
    [addPatch, patchPath],
  );
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (active?.id !== over?.id) {
        const oldIndex = items.findIndex((i) => i.id === Number(active?.id));
        const newIndex = items.findIndex((i) => i.id === Number(over?.id));
        setItems((prev) => arrayMove(prev, oldIndex, newIndex));
        onMove(oldIndex, newIndex);
      }
      setActiveId(null);
    },
    [items, onMove],
  );

  if (schemaAtPath.status === "error" || schemaAtPath.status === "not-found") {
    return null;
  }
  if (schemaAtPath.status === "loading" || sourcePaths === null) {
    return null;
  }
  if (schemaAtPath.data.type !== "array") {
    return null;
  }
  const schema = schemaAtPath.data as SerializedArraySchema;

  const renderRow = (item: { path: SourcePath; id: number }, index: number) => (
    <BlockRow
      key={item.id}
      id={item.id}
      index={index}
      path={item.path}
      itemSchema={schema.item}
      depth={depth}
      readonly={readonly}
      onNavigate={(p) => navigate(p)}
      onDelete={() => {
        addPatch(
          [
            {
              op: "remove",
              path: patchPath.concat(
                index.toString(),
              ) as array.NonEmptyArray<string>,
            },
          ],
          type,
        );
      }}
      onDuplicate={() => {
        if (
          "data" in sourceAtPath &&
          sourceAtPath.data &&
          Array.isArray(sourceAtPath.data)
        ) {
          addPatch(
            [
              {
                op: "add",
                path: patchPath.concat(index.toString()),
                value: (sourceAtPath.data[index] ?? null) as JSONValue,
              },
            ],
            type,
          );
        }
      }}
    />
  );

  return (
    <div id={path} className={cn("w-full", { [DENSE_FIELDS]: depth === 0 })}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(event) => setActiveId(Number(event.active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <SortableContext
          items={items}
          strategy={verticalListSortingStrategy}
          disabled={readonly}
        >
          <div className="flex flex-col gap-1 w-full">
            {items.map((item, index) => (
              <div
                key={item.id}
                style={{ opacity: item.id === activeId ? 0.3 : undefined }}
              >
                {renderRow(item, index)}
              </div>
            ))}
          </div>
        </SortableContext>
        {/* No drop animation — same reasoning as SortableList: the overlay
            renders a positional path, and the content at that path changes the
            moment the patch lands. */}
        <DragOverlay dropAnimation={null}>
          {activeItem ? renderRow(activeItem, items.indexOf(activeItem)) : null}
        </DragOverlay>
      </DndContext>
      {!readonly && (
        <button
          className="flex items-center gap-1 h-6 mt-0.5 px-1 text-xs text-fg-tertiary hover:text-fg-primary"
          onClick={() => {
            addPatch(
              [
                {
                  op: "add",
                  path: patchPath.concat(items.length.toString()),
                  value: emptyOf(schema.item) as JSONValue,
                },
              ],
              type,
            );
          }}
        >
          <Plus size={12} />
          <span>Add</span>
        </button>
      )}
    </div>
  );
}

function BlockRow({
  id,
  index,
  path,
  itemSchema,
  depth,
  readonly,
  onNavigate,
  onDelete,
  onDuplicate,
}: {
  id: number;
  index: number;
  path: SourcePath;
  itemSchema: SerializedSchema;
  depth: number;
  readonly?: boolean;
  onNavigate: (path: SourcePath) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id, disabled: readonly === true });
  const [collapsed, setCollapsed] = useState(false);
  const validationErrors = useValidationErrors(path);
  const style = { transform: CSS.Transform.toString(transform), transition };
  const isInline = isInlineRender(itemSchema);
  // An inline object gets a header row (index, summary, collapse) above its
  // fields; an inline leaf is a single line with the editor in it.
  //
  // A union is headered too: it is an object once the tag is chosen, and a
  // page-builder list is a union of blocks, so these are the rows that most
  // need a title to collapse to.
  const headered =
    isInline &&
    (itemSchema.type === "object" ||
      // A union of string literals is one select — a leaf, not a block.
      (itemSchema.type === "union" && isObjectUnion(itemSchema)));

  const grip = (
    <button
      {...attributes}
      {...listeners}
      className={cn(
        "cursor-grab text-fg-quaternary hover:text-fg-primary",
        // See `DRAG_HANDLE_TOUCH`.
        DRAG_HANDLE_TOUCH,
        { "opacity-30": readonly },
      )}
      disabled={readonly}
    >
      <GripVertical size={14} />
    </button>
  );
  // Readonly means readonly: with the menu still rendered, Delete and
  // Duplicate stayed live and wrote patches even though the grip and every
  // field were disabled.
  const menu = readonly ? null : (
    <RowMenu onDelete={onDelete} onDuplicate={onDuplicate} />
  );

  return (
    <div
      /* The row is the anchor for its own path: nothing inside an inline row
         goes through `Field`, so without this a navigation to a path in this
         list has nothing to scroll to (see `scrollToStudioPath`). */
      data-val-studio-path={path}
      ref={setNodeRef}
      style={style}
      className={cn(
        "border bg-bg-primary",
        // See `SORTABLE_ROW_TOUCH`.
        SORTABLE_ROW_TOUCH,
        // A nested row shares its parent row's LEFT border instead of drawing
        // its own: the parent's body has no left padding, so the child sits
        // flush against that edge — one border line, and the horizontal room
        // that a second border + padding used to cost comes back as content.
        depth === 0 ? "rounded-md" : "rounded-r-md border-l-0",
        {
          "border-border-primary": validationErrors.length === 0,
          "border-bg-warning-secondary": validationErrors.length > 0,
        },
      )}
    >
      {headered && (
        <div className="flex items-center gap-1 h-7 px-1.5">
          {grip}
          <button
            className="flex items-center gap-1 flex-1 min-w-0 text-left"
            onClick={() => setCollapsed((prev) => !prev)}
          >
            <ChevronRight
              size={12}
              className={cn(
                "shrink-0 text-fg-quaternary transition-transform",
                { "rotate-90": !collapsed },
              )}
            />
            <span className="w-4 shrink-0 text-[10px] text-fg-quaternary">
              {index + 1}
            </span>
            <RowSummary path={path} />
          </button>
          {menu}
        </div>
      )}
      {headered && !collapsed && (
        // Right padding only: nested lists reach the left border (see the row
        // class above); leaf fields add their own small left inset.
        <div className="pr-1.5 pb-1.5 pt-0.5">
          {itemSchema.type === "union" ? (
            <InlineUnionBody
              path={path}
              itemSchema={itemSchema}
              depth={depth}
              readonly={readonly}
            />
          ) : (
            <InlineObjectBody
              path={path}
              itemSchema={itemSchema}
              depth={depth}
              readonly={readonly}
            />
          )}
        </div>
      )}
      {isInline && !headered && (
        <div className="flex items-start gap-1.5 px-1.5 py-1">
          <div className="pt-2">{grip}</div>
          <div className="flex-1 min-w-0">
            <AnyField
              path={path}
              schema={itemSchema}
              readonly={readonly === true || itemSchema.readonly === true}
              compact
              errorDisplay="none"
            />
          </div>
          {menu}
        </div>
      )}
      {!isInline && (
        <div className="flex items-center gap-1.5 px-1.5 py-1">
          {grip}
          <button
            className="flex-1 min-w-0 overflow-y-clip rounded text-left text-xs hover:bg-bg-secondary-hover"
            style={{ maxHeight: 96 }}
            onClick={() => onNavigate(path)}
          >
            <RefPreview path={path} className="w-full" />
          </button>
          {menu}
        </div>
      )}
      {validationErrors.length > 0 && (
        <div className="px-2.5 pb-1.5">
          <FieldValidationError validationErrors={validationErrors} />
        </div>
      )}
    </div>
  );
}

/**
 * One inline union item: the tag selector, then the variant's own fields laid
 * out by {@link InlineObjectBody} — so a block in a page-builder list reads
 * like every other row instead of like a stack of folding cards.
 *
 * The selection itself comes from `useObjectUnion`, which the union FIELD uses
 * too. Switching a tag is not a `replace` of the discriminator: it remembers
 * the source of each tag you leave, so switching away and back gives you what
 * you typed. Two implementations of that would be two answers.
 */
function InlineUnionBody({
  path,
  itemSchema,
  depth,
  readonly,
}: {
  path: SourcePath;
  itemSchema: SerializedUnionSchema;
  depth: number;
  readonly?: boolean;
}) {
  // A union of string literals has no variant to lay out — it is one select,
  // drawn by the leaf branch above. Narrowed HERE rather than inside the body
  // below, so that `useObjectUnion` is never called behind a condition.
  if (!isObjectUnion(itemSchema)) {
    return null;
  }
  return (
    <InlineObjectUnionBody
      path={path}
      itemSchema={itemSchema}
      depth={depth}
      readonly={readonly}
    />
  );
}

function InlineObjectUnionBody({
  path,
  itemSchema,
  depth,
  readonly,
}: {
  path: SourcePath;
  itemSchema: SerializedObjectUnionSchema;
  depth: number;
  readonly?: boolean;
}) {
  const state = useObjectUnion(path, itemSchema);
  if (state.status === "loading") {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="pl-2">
        <ObjectUnionTagSelect
          state={state}
          readonly={readonly}
          className="h-7 w-auto min-w-24 px-2 py-1 text-[13px]"
        />
      </div>
      <InlineObjectBody
        path={path}
        itemSchema={state.selectedSchema}
        depth={depth}
        readonly={readonly}
        omitKeys={[itemSchema.key]}
      />
    </div>
  );
}

/**
 * The fields of one inline object item, laid out tightly. A field that is
 * itself an array of inline items recurses into a nested `BlockList` behind a
 * thin rail, instead of another card-in-card — that rail is most of what buys
 * the third level on a laptop.
 */
function InlineObjectBody({
  path,
  itemSchema,
  depth,
  readonly,
  omitKeys,
}: {
  path: SourcePath;
  itemSchema: SerializedSchema;
  depth: number;
  readonly?: boolean;
  /** Fields the row draws elsewhere — a union's discriminator, which is the
   * tag selector above rather than a field of its own. */
  omitKeys?: string[];
}) {
  // Which nested lists are folded away. Hiding fields is what buys clearance
  // on the left once the rows themselves stopped indenting.
  const [hiddenLists, setHiddenLists] = useState<Record<string, boolean>>({});
  if (itemSchema.type !== "object") {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {Object.entries(itemSchema.items).map(([key, fieldSchema]) => {
        if (fieldSchema.hidden || omitKeys?.includes(key)) {
          return null;
        }
        const fieldPath = sourcePathOfItem(path, key);
        const fieldReadonly =
          readonly === true || fieldSchema.readonly === true;
        if (fieldSchema.type === "array" && isInlineRender(fieldSchema.item)) {
          const hidden = hiddenLists[key] === true;
          return (
            <div key={key} className="flex flex-col gap-1">
              <button
                className="flex items-center gap-1 pl-2 text-left"
                onClick={() =>
                  setHiddenLists((prev) => ({ ...prev, [key]: !hidden }))
                }
              >
                <ChevronRight
                  size={10}
                  className={cn(
                    "shrink-0 text-fg-quaternary transition-transform",
                    { "rotate-90": !hidden },
                  )}
                />
                <FieldLabel label={key} />
              </button>
              {!hidden && (
                <BlockList
                  path={fieldPath}
                  depth={depth + 1}
                  readonly={fieldReadonly}
                />
              )}
            </div>
          );
        }
        return (
          <div key={key} className="flex flex-col gap-0.5 pl-2">
            <FieldLabel label={key} />
            <AnyField
              path={fieldPath}
              schema={fieldSchema}
              readonly={fieldReadonly}
              compact
              errorDisplay="compact"
            />
          </div>
        );
      })}
    </div>
  );
}

function FieldLabel({ label }: { label: string }) {
  return (
    <span className="text-[11px] leading-4 text-fg-tertiary">{label}</span>
  );
}

/**
 * One line of the row's own content, for the collapsed (and header) state.
 *
 * This is the one place a `preview` still has a say in an inline row, and it
 * is not a contradiction: the preview says what the value IS, which is exactly
 * what a header that can collapse the editor away needs. It never decides how
 * the row is EDITED — that is the render, and inline wins it outright. Without
 * a declared preview, the first string in the value stands in.
 */
function RowSummary({ path }: { path: SourcePath }) {
  const preview = useRefPreview(path);
  const sourceAtPath = useSourceAtPath(path);
  const summary = useMemo(() => {
    if (preview?.title) {
      return preview.title;
    }
    if ("data" in sourceAtPath && sourceAtPath.data !== undefined) {
      return firstStringOf(sourceAtPath.data);
    }
    return null;
  }, [preview, sourceAtPath]);
  return (
    <span className="flex-1 min-w-0 truncate text-xs text-fg-tertiary">
      {summary ?? ""}
    </span>
  );
}

/**
 * Depth-first first string in a source — a cheap stand-in for a title when the
 * schema has no `preview`. Skips the keys that are structure rather than
 * content: a union's discriminator, and a rich text node's `tag`, which would
 * otherwise title a whole text block "p".
 */
function firstStringOf(source: Json): string | null {
  if (typeof source === "string") {
    return source;
  }
  if (Array.isArray(source)) {
    for (const item of source) {
      const found = firstStringOf(item);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  if (source !== null && typeof source === "object") {
    for (const [key, value] of Object.entries(source)) {
      if (key === "type" || key === "_type" || key === "tag") {
        continue;
      }
      if (value === undefined) {
        continue;
      }
      const found = firstStringOf(value);
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
}

function RowMenu({
  onDelete,
  onDuplicate,
}: {
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const portalContainer = useValPortal();
  return (
    <Popover>
      <PopoverTrigger className="shrink-0 rounded px-0.5 py-1 text-fg-quaternary hover:text-fg-primary hover:bg-bg-secondary-hover">
        <EllipsisVertical size={14} />
      </PopoverTrigger>
      <PopoverContent
        className="p-2 w-auto"
        container={portalContainer}
        side="top"
      >
        <button
          className="flex items-center gap-x-2 text-sm"
          onClick={onDelete}
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete</span>
        </button>
        <button
          className="flex items-center gap-x-2 text-sm"
          onClick={onDuplicate}
        >
          <Copy className="w-3.5 h-3.5" />
          <span>Duplicate</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}
