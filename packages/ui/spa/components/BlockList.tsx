import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  ChevronRight,
  Copy,
  EllipsisVertical,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Internal,
  Json,
  SerializedSchema,
  SerializedArraySchema,
  SerializedDiscriminatedUnionSchema,
  SerializedRecordSchema,
  SourcePath,
  isInlineRender,
} from "@valbuild/core";
import { hasLocaleRouteParam, isLocaleSchema } from "@valbuild/shared/internal";
import { array } from "@valbuild/core/fp";
import { JSONValue } from "@valbuild/core/patch";
import {
  useAddPatch,
  useSchemaAtPath,
  useShallowSourceAtPath,
  useSourceAtPath,
  useValField,
} from "./ValFieldProvider";
import { useValidationErrors } from "./ValErrorProvider";
import { AnyField } from "./AnyField";
import {
  DiscriminatedUnionTagSelect,
  useDiscriminatedUnion,
} from "./fields/DiscriminatedUnionField";
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
import {
  LocaleFiltered,
  useLocaleFilterPredicate,
} from "./LocaleFilterProvider";
import { useArrayAndRecordTools } from "./ArrayAndRecordTools";
import { ChangeRecordPopover } from "./ChangeRecordPopover";
import { DuplicateRecordPopover } from "./DuplicateRecordPopover";
import { DeleteRecordPopover } from "./DeleteRecordPopover";
import { AddRecordPopover } from "./AddRecordPopover";
import { fromCamelToTitleCase } from "../utils/prettifyText";
import { ContentViewsBadge } from "../analytics/ContentViewsBadge";

/**
 * The inline list: an array or a record whose items are edited in place, dense
 * enough that a page-builder tree — lists of inline objects nested three
 * levels deep — fits on a laptop screen.
 *
 * `ArrayFields` and `RecordFields` render this whenever the container
 * declares `.render({ as: "inline" })` (see `isInlineRender`), so an array
 * and a record that both say "inline" look the same: one row per item, the
 * index or the key as its label, a menu for what can be done to it. Lists of
 * preview rows (`SortableList`, the record list) are untouched by any of this.
 *
 * What it does differently from `SortableList`:
 * - Each item is EDITED IN PLACE inside its (sortable) row, because the list
 *   said so. The decision reads straight off the serialized ARRAY schema —
 *   the item has no say.
 * - Object items get a compact header (grip, index or key, summary, collapse)
 *   and lay their fields out tightly; a nested inline list is indented to its
 *   label and carries its Add on that label's row.
 * - Leaf items (string, number, ...) are a single row: grip or key, the field,
 *   menu.
 * - A record's rows have no grip: a record has no order.
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
  showAdd = true,
}: {
  path: SourcePath;
  readonly?: boolean;
  /** Nesting level, used only for layout. */
  depth?: number;
  /**
   * Whether the list draws its own "Add" under the last row. A nested list
   * does not: its Add sits on the label row above it, where it is one line
   * instead of a stack of Adds closing every level at once.
   */
  showAdd?: boolean;
}) {
  const schemaAtPath = useSchemaAtPath(path);
  if (schemaAtPath.status !== "success") {
    return null;
  }
  if (schemaAtPath.data.type === "record") {
    return (
      <RecordBlockList
        path={path}
        schema={schemaAtPath.data}
        readonly={readonly}
        depth={depth}
        showAdd={showAdd}
      />
    );
  }
  if (schemaAtPath.data.type === "array") {
    return (
      <ArrayBlockList
        path={path}
        readonly={readonly}
        depth={depth}
        showAdd={showAdd}
      />
    );
  }
  return null;
}

function ArrayBlockList({
  path,
  readonly,
  depth,
  showAdd,
}: {
  path: SourcePath;
  readonly?: boolean;
  depth: number;
  showAdd: boolean;
}) {
  const type = "array";
  const { navigate } = useNavigation();
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

  const emptyOf = useEmptyOf();
  const containerRef = useRef<HTMLDivElement>(null);
  /**
   * Where focus goes once the list has caught up with an edit made from the
   * keyboard. After an insert, into the new item: grip, Tab to the bar above
   * it, Enter, and you are typing in it. After a move, to the moved item's
   * position picker, so moving it again is one more keypress.
   */
  const pendingFocus = useRef<{
    index: number;
    target: "body" | "position";
  } | null>(null);
  useEffect(() => {
    const pending = pendingFocus.current;
    if (
      pending === null ||
      sourcePaths === null ||
      pending.index >= sourcePaths.length
    ) {
      return;
    }
    const { index, target: focusTarget } = pending;
    pendingFocus.current = null;
    // After paint: the row for the new index re-renders with its new content
    // in the same commit this effect runs after, but its fields mount lazily.
    requestAnimationFrame(() => {
      const row = containerRef.current?.querySelector(
        `[data-block-index="${index}"]`,
      );
      // The row's own controls come before any nested row's in the DOM, so
      // the first match is this row's.
      const target =
        focusTarget === "position"
          ? row?.querySelector<HTMLElement>("[data-block-position]")
          : (row?.querySelector<HTMLElement>(
              "[data-block-body] :is(input, textarea, [contenteditable='true'], [role='combobox'])",
            ) ?? row?.querySelector<HTMLElement>("[data-block-grip]"));
      target?.focus();
    });
  }, [sourcePaths]);

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
  const insertAt = (index: number) => {
    pendingFocus.current = { index, target: "body" };
    addPatch(
      [
        {
          op: "add",
          path: patchPath.concat(index.toString()),
          value: emptyOf(schema.item) as JSONValue,
        },
      ],
      type,
    );
  };

  // The keyboard's (and anyone's) way to reorder: pick a position. The same
  // optimistic reorder and `move` patch as a drag.
  const moveTo = (from: number, to: number) => {
    if (from === to) {
      return;
    }
    pendingFocus.current = { index: to, target: "position" };
    setItems((prev) => arrayMove(prev, from, to));
    onMove(from, to);
  };

  const renderRow = (
    item: { path: SourcePath; id: number },
    index: number,
    isOverlay: boolean,
  ) => (
    <LocaleFiltered key={item.id} path={item.path}>
      <SortableBlockRow
        id={item.id}
        onInsertAbove={
          readonly || isOverlay ? undefined : () => insertAt(index)
        }
        onInsertBelow={
          readonly || isOverlay || index !== items.length - 1
            ? undefined
            : () => insertAt(index + 1)
        }
        path={item.path}
        label={{
          kind: "index",
          index,
          count: items.length,
          onMove: readonly || isOverlay ? undefined : (to) => moveTo(index, to),
        }}
        itemSchema={schema.item}
        isInline={isInlineRender(schema)}
        depth={depth}
        readonly={readonly}
        onNavigate={(p) => navigate(p)}
        menu={
          // Readonly means readonly: with the menu still rendered, Delete and
          // Duplicate stayed live and wrote patches even though the grip and
          // every field were disabled.
          readonly ? null : (
            <ArrayRowMenu
              onInsertAbove={() => insertAt(index)}
              onInsertBelow={() => insertAt(index + 1)}
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
          )
        }
      />
    </LocaleFiltered>
  );

  return (
    <div
      id={path}
      ref={containerRef}
      className={cn("w-full", {
        [DENSE_FIELDS]: depth === 0,
        // Nothing to insert between while a row is in the air.
        "[&_[data-insert-bar]]:invisible": activeId !== null,
      })}
    >
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
          {/* The gaps are the insert bars' room: each row draws the bar
              above itself in the gap over it (and the last row the one below
              it too), so a gap is exactly one bar tall. */}
          <div
            className={cn("flex flex-col w-full", {
              "gap-3 py-3": !readonly && items.length > 0,
              "gap-1": readonly,
            })}
          >
            {/* `empty:hidden` — see `SortableList`, same wrapper, same reason. */}
            {items.map((item, index) => (
              <div
                key={item.id}
                className="empty:hidden"
                style={{ opacity: item.id === activeId ? 0.3 : undefined }}
              >
                {renderRow(item, index, false)}
              </div>
            ))}
          </div>
        </SortableContext>
        {/* No drop animation — same reasoning as SortableList: the overlay
            renders a positional path, and the content at that path changes the
            moment the patch lands. */}
        <DragOverlay dropAnimation={null}>
          {activeItem
            ? renderRow(activeItem, items.indexOf(activeItem), true)
            : null}
        </DragOverlay>
      </DndContext>
      {/* With rows, the bar under the last one is the Add. An empty list has
          no bars, so it keeps the button. */}
      {showAdd && !readonly && items.length === 0 && (
        <ListAddButton path={path} />
      )}
    </div>
  );
}

/**
 * An inline RECORD, drawn with the same rows as an inline array so the two
 * read as one thing: the key is the row's label where an array has its index,
 * and the row menu holds what a record can do to an entry (rename, duplicate,
 * delete) where an array's holds duplicate and delete.
 *
 * There is no grip, because a record is not ordered — there is nowhere to
 * drag an entry to.
 */
function RecordBlockList({
  path,
  schema,
  readonly,
  depth,
  showAdd,
}: {
  path: SourcePath;
  schema: SerializedRecordSchema;
  readonly?: boolean;
  depth: number;
  showAdd: boolean;
}) {
  const { navigate } = useNavigation();
  const matchesLocale = useLocaleFilterPredicate();
  const sourceAtPath = useShallowSourceAtPath(path, "record");
  if (!("data" in sourceAtPath) || !sourceAtPath.data) {
    return null;
  }
  const source = sourceAtPath.data;
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  const router =
    schema.router !== undefined ? { schema, moduleFilePath } : undefined;
  // The same two rules as `RecordFields`: a locale-keyed record (or a router
  // whose routes name their language) is filtered on the KEY, every other
  // record by asking each entry.
  const keyDecidesLocale =
    (schema.key !== undefined && isLocaleSchema(schema.key)) ||
    hasLocaleRouteParam(schema);
  const entries = schema.item.hidden
    ? []
    : Object.entries(source).filter(([key, itemPath]) =>
        matchesLocale({
          key,
          keySchema: schema.key,
          router,
          path: itemPath,
        }),
      );
  const itemReadonly = readonly === true || schema.item.readonly === true;
  return (
    <div id={path} className={cn("w-full", { [DENSE_FIELDS]: depth === 0 })}>
      <div className="flex flex-col gap-1 w-full">
        {entries.map(([key, itemPath]) => {
          const row = (
            <BlockRow
              path={itemPath}
              label={{ kind: "key", key }}
              itemSchema={schema.item}
              isInline={true}
              depth={depth}
              readonly={itemReadonly}
              onNavigate={(p) => navigate(p)}
              menu={readonly ? null : <RecordRowMenu path={itemPath} />}
            />
          );
          return keyDecidesLocale ? (
            <div key={itemPath}>{row}</div>
          ) : (
            <LocaleFiltered key={itemPath} path={itemPath}>
              {row}
            </LocaleFiltered>
          );
        })}
      </div>
      {showAdd && !readonly && <ListAddButton path={path} />}
    </div>
  );
}

type RowLabel =
  | {
      kind: "index";
      index: number;
      count: number;
      /** Absent when the row cannot move: readonly, or the drag overlay. */
      onMove?: (to: number) => void;
    }
  | { kind: "key"; key: string };

function SortableBlockRow({
  id,
  readonly,
  ...props
}: Omit<Parameters<typeof BlockRow>[0], "sortable"> & { id: number }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id, disabled: readonly === true });
  return (
    <BlockRow
      {...props}
      readonly={readonly}
      sortable={{
        handleProps: { ...attributes, ...listeners },
        setNodeRef,
        style: { transform: CSS.Transform.toString(transform), transition },
      }}
    />
  );
}

function BlockRow({
  path,
  label,
  itemSchema,
  isInline,
  depth,
  readonly,
  onNavigate,
  menu,
  sortable,
  onInsertAbove,
  onInsertBelow,
}: {
  path: SourcePath;
  /** An array row is numbered, a record row is named by its key. */
  label: RowLabel;
  itemSchema: SerializedSchema;
  /** The LIST's render, not the item's: see `isInlineRender`. */
  isInline: boolean;
  depth: number;
  readonly?: boolean;
  onNavigate: (path: SourcePath) => void;
  menu: React.ReactNode;
  /** Absent for a record: its entries have no order to change. */
  sortable?: {
    handleProps: React.ButtonHTMLAttributes<HTMLButtonElement>;
    setNodeRef: (node: HTMLElement | null) => void;
    style: React.CSSProperties;
  };
  /** Draws the insert bar in the gap above the row. */
  onInsertAbove?: () => void;
  /** Draws one below it too — the last row's, which is the list's Add. */
  onInsertBelow?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const validationErrors = useValidationErrors(path);
  // An inline object gets a header row (label, summary, collapse) above its
  // fields; an inline leaf is a single line with the editor in it.
  //
  // A discriminated union is headered too: it is an object once the tag is
  // chosen, and a page-builder list is a union of blocks, so these are the
  // rows that most need a title to collapse to. An enum is one select — a
  // leaf, not a block — so it is not headered.
  const headered =
    isInline &&
    (itemSchema.type === "object" || itemSchema.type === "discriminated-union");

  // The gutter: the row's whole left edge is the drag handle, which is a
  // bigger target than the grip icon alone, and brand-coloured on hover or
  // keyboard focus so it says "this moves".
  //
  // No gutter at all when there is nothing to drag: a readonly list cannot be
  // reordered, and a record has no order.
  const rowNumber = label.kind === "index" ? label.index + 1 : undefined;
  const gutter =
    sortable && !readonly ? (
      <button
        {...sortable.handleProps}
        data-block-grip=""
        aria-label={
          rowNumber !== undefined ? `Move item ${rowNumber}` : "Move item"
        }
        className={cn(
          // The insert bar above this row is the next sibling, and shows its
          // plus while this has keyboard focus — it is also the next Tab
          // stop, so the plus says where Tab goes. See `InsertBar`.
          "flex w-4 shrink-0 cursor-grab items-start justify-center self-stretch rounded-sm pt-3",
          "text-fg-secondary-alt outline-none transition-colors",
          // Quiet at rest: just the grip icon. The strip appears while its
          // row is hovered or holds focus — the INNERMOST such row only, so
          // working in a nested list does not light every level above it.
          // `>`: the gutter is the row's own direct child.
          "[[data-block-row]:hover:not(:has([data-block-row]:hover))>&]:bg-bg-secondary",
          "[[data-block-row]:focus-within:not(:has([data-block-row]:focus-within))>&]:bg-bg-secondary",
          "hover:bg-bg-brand-primary hover:text-fg-brand-primary",
          "focus-visible:bg-bg-brand-primary focus-visible:text-fg-brand-primary",
          // See `DRAG_HANDLE_TOUCH`.
          DRAG_HANDLE_TOUCH,
        )}
      >
        <GripVertical size={14} />
      </button>
    ) : null;

  return (
    <div
      /* The row is the anchor for its own path: nothing inside an inline row
         goes through `Field`, so without this a navigation to a path in this
         list has nothing to scroll to (see `scrollToStudioPath`). */
      data-val-studio-path={path}
      data-block-row=""
      data-block-index={label.kind === "index" ? label.index : undefined}
      ref={sortable?.setNodeRef}
      style={sortable?.style}
      className={cn(
        "relative flex",
        // See `SORTABLE_ROW_TOUCH`.
        { [SORTABLE_ROW_TOUCH]: sortable !== undefined },
      )}
    >
      {gutter}
      {onInsertAbove && (
        <InsertBar
          position="above"
          label={
            rowNumber !== undefined
              ? `Add item above item ${rowNumber}`
              : "Add item above"
          }
          onClick={onInsertAbove}
        />
      )}
      {/* The card. The gutter is outside its border, beside it. */}
      <div
        className={cn("flex-1 min-w-0 border bg-bg-primary", {
          "rounded-md": true,
          "border-border-primary": validationErrors.length === 0,
          "border-bg-warning-secondary": validationErrors.length > 0,
        })}
      >
        {headered && (
          <div className="flex items-center gap-1.5 h-9 px-2">
            {/* An array row's number is a control (it moves the row), so it
                cannot be inside the collapse button. A key is just text. */}
            {label.kind === "index" && <RowLabelText label={label} />}
            <button
              className="flex items-center gap-2 flex-1 min-w-0 h-full text-left"
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((prev) => !prev)}
            >
              <ChevronRight
                size={16}
                className={cn(
                  "shrink-0 text-fg-secondary-alt transition-transform",
                  { "rotate-90": !collapsed },
                )}
              />
              {label.kind === "key" && <RowLabelText label={label} />}
              <RowSummary
                path={path}
                unionKey={
                  itemSchema.type === "discriminated-union"
                    ? itemSchema.key
                    : undefined
                }
                muted={label.kind === "key"}
              />
            </button>
            <ContentViewsBadge path={path} />
            {menu}
          </div>
        )}
        {headered && !collapsed && (
          // The fields carry their own small left inset (see
          // `InlineObjectBody`), so the body only pads the right and bottom.
          <div data-block-body="" className="pr-1.5 pb-1.5">
            {itemSchema.type === "discriminated-union" ? (
              <InlineDiscriminatedUnionBody
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
          <div
            data-block-body=""
            className="flex items-start gap-1.5 px-1.5 py-1"
          >
            {/* `h-7`, the height of a dense input, so a key and the menu line
              up with the first line of the field however tall it grows. */}
            <div
              className={cn("flex items-center h-7 shrink-0", {
                "max-w-[40%]": label.kind === "key",
              })}
            >
              <RowLabelText label={label} />
            </div>
            <div className="flex-1 min-w-0">
              <AnyField
                path={path}
                schema={itemSchema}
                readonly={readonly === true || itemSchema.readonly === true}
                compact
                errorDisplay="none"
              />
            </div>
            <ContentViewsBadge path={path} />
            {menu && <div className="flex items-center h-7">{menu}</div>}
          </div>
        )}
        {!isInline && (
          <div className="flex items-center gap-1.5 px-1.5 py-1">
            <button
              className="flex-1 min-w-0 overflow-y-clip rounded text-left text-xs hover:bg-bg-secondary-hover"
              style={{ maxHeight: 96 }}
              onClick={() => onNavigate(path)}
            >
              <RefPreview path={path} className="w-full" />
            </button>
            <ContentViewsBadge path={path} />
            {menu}
          </div>
        )}
        {validationErrors.length > 0 && (
          <div className="px-2.5 pb-1.5">
            <FieldValidationError validationErrors={validationErrors} />
          </div>
        )}
      </div>
      {onInsertBelow && (
        <InsertBar
          position="below"
          label="Add item at the end"
          onClick={onInsertBelow}
        />
      )}
    </div>
  );
}

/**
 * The bar in the gap between two rows: an insert there. Invisible at rest —
 * the gap is just a gap — and on hover or focus a plus appears in the middle
 * of it, between two short brand lines that fade out. The row menu's "Add above" / "Add below" are the same inserts for
 * anyone who does not find the gap.
 *
 * Absolutely placed in the gap the list leaves for it, but in the DOM it sits
 * inside the row — "above" right after the row's grip, "below" after the
 * row's content — so Tab reaches it from the grip, which is the order it is
 * read in.
 */
function InsertBar({
  position,
  label,
  onClick,
}: {
  position: "above" | "below";
  label: string;
  onClick: () => void;
}) {
  // Each piece is a direct child of the bar, so one selector per state reaches
  // all three: the bar's own hover/focus, or the grip right before it holding
  // keyboard focus. `+` and `>`, never `~` or a descendant selector: the grip
  // lights the bar right after it (its own row's "above"), not the row's
  // "below" bar or any bar nested inside the row.
  const shown = cn(
    "opacity-0 transition-opacity",
    "group-hover/insert:opacity-100 group-focus-visible/insert:opacity-100",
    "[[data-block-grip]:focus-visible+[data-insert-bar]>&]:opacity-100",
  );
  // Short, and fading out away from the plus, so it reads as a mark at one
  // place between two rows rather than as another border.
  const line = "h-0.5 w-1/4 max-w-32 rounded-full to-transparent";
  return (
    <button
      type="button"
      data-insert-bar=""
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        // The whole gap is the target; what shows is centred over the card
        // (not the gutter).
        "group/insert absolute left-4 right-0 flex h-3 items-center justify-center gap-1.5 outline-none",
        position === "above" ? "-top-3" : "-bottom-3",
      )}
    >
      <span
        className={cn(
          line,
          "bg-gradient-to-l from-border-brand-primary",
          shown,
        )}
      />
      <Plus
        size={14}
        strokeWidth={2.5}
        className={cn("text-fg-primary", shown)}
      />
      <span
        className={cn(
          line,
          "bg-gradient-to-r from-border-brand-primary",
          shown,
        )}
      />
    </button>
  );
}

function RowLabelText({ label }: { label: RowLabel }) {
  if (label.kind === "index" && label.onMove) {
    return (
      <PositionSelect
        index={label.index}
        count={label.count}
        onMove={label.onMove}
      />
    );
  }
  if (label.kind === "index") {
    return (
      <span className="min-w-6 shrink-0 text-center text-sm tabular-nums text-fg-secondary-alt">
        {label.index + 1}
      </span>
    );
  }
  // A key is data, not a field name, so it is shown as written — never
  // title-cased the way `FieldLabel` treats a schema's own keys.
  return (
    <span className="min-w-0 shrink-0 max-w-full truncate font-mono text-sm font-medium text-fg-primary">
      {label.key}
    </span>
  );
}

/**
 * The item's number, which is also where it can be moved to: click it (or
 * Enter on it) and pick another number, and the item moves there — the
 * keyboard's twin of dragging the gutter.
 *
 * A button and a popover, not a native `<select>`: a select is a `combobox`,
 * and a union row's variant picker is already the row's combobox. Two of
 * them made "the row's picker" ambiguous, to a screen reader as much as to
 * a test.
 */
function PositionSelect({
  index,
  count,
  onMove,
}: {
  index: number;
  count: number;
  onMove: (to: number) => void;
}) {
  const portalContainer = useValPortal();
  const [open, setOpen] = useState(false);
  const moved = useRef(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-block-position=""
        aria-label={`Item ${index + 1} of ${count}. Move to another position`}
        title="Move to position"
        className={cn(
          "h-6 min-w-6 shrink-0 rounded px-1 text-center text-sm tabular-nums text-fg-secondary outline-none",
          "hover:bg-bg-secondary-hover hover:text-fg-primary",
          "focus-visible:ring-1 focus-visible:ring-border-focus",
          "data-[state=open]:bg-bg-secondary-hover data-[state=open]:text-fg-primary",
        )}
      >
        {index + 1}
      </PopoverTrigger>
      <PopoverContent
        container={portalContainer}
        side="bottom"
        align="start"
        className="w-auto max-w-56 p-1.5"
        onCloseAutoFocus={(event) => {
          // After a move, focus goes to the moved item's number instead (see
          // `pendingFocus`); this trigger now belongs to whatever slid in.
          if (moved.current) {
            event.preventDefault();
            moved.current = false;
          }
        }}
      >
        <div className="px-1 pb-1 text-xs text-fg-tertiary">
          Move to position
        </div>
        <div className="grid max-h-48 grid-cols-6 gap-0.5 overflow-y-auto">
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-current={i === index ? "true" : undefined}
              aria-label={i === index ? `${i + 1} (current)` : `${i + 1}`}
              disabled={i === index}
              onClick={() => {
                moved.current = true;
                setOpen(false);
                onMove(i);
              }}
              className={cn(
                "h-7 min-w-7 rounded text-xs tabular-nums text-fg-primary",
                "hover:bg-bg-secondary-hover focus-visible:bg-bg-secondary-hover focus-visible:outline-none",
                "disabled:bg-bg-brand-primary disabled:text-fg-brand-primary",
              )}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One inline discriminated union item: the tag selector, then the variant's own
 * fields laid out by {@link InlineObjectBody} — so a block in a page-builder
 * list reads like every other row instead of like a stack of folding cards.
 *
 * The selection itself comes from `useDiscriminatedUnion`, which the union
 * FIELD uses too. Switching a tag is not a `replace` of the discriminator: it
 * remembers the source of each tag you leave, so switching away and back gives
 * you what you typed. Two implementations of that would be two answers.
 */
function InlineDiscriminatedUnionBody({
  path,
  itemSchema,
  depth,
  readonly,
}: {
  path: SourcePath;
  itemSchema: SerializedDiscriminatedUnionSchema;
  depth: number;
  readonly?: boolean;
}) {
  const state = useDiscriminatedUnion(path, itemSchema);
  if (state.status === "loading") {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {/* Labelled like every other field: it is the discriminator, which is
          a field of the value even though it is drawn as the variant picker. */}
      <div className="flex flex-col gap-0.5 pl-2">
        <FieldLabel label={itemSchema.key} />
        <DiscriminatedUnionTagSelect
          state={state}
          readonly={readonly}
          className="h-7 w-auto min-w-24 self-start px-2 py-1 text-[13px]"
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
 * The fields of one inline object, laid out tightly: a small label (with the
 * field's description under it — it is being entered here, so it gets its
 * input help), then the field. A field that is itself an inline array or
 * record recurses into a nested `BlockList`, indented to line up with the
 * labels, with its Add on the label row.
 *
 * Exported for `KeyOfField`, whose inline render shows the referenced entry
 * the same way a row shows its own.
 */
export function InlineObjectBody({
  path,
  itemSchema,
  depth = 0,
  readonly,
  omitKeys,
}: {
  path: SourcePath;
  itemSchema: SerializedSchema;
  depth?: number;
  readonly?: boolean;
  /** Fields the row draws elsewhere — a union's discriminator, which is the
   * tag selector above rather than a field of its own. */
  omitKeys?: string[];
}) {
  // Which nested lists are folded away.
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
        const isNestedList =
          isInlineRender(fieldSchema) &&
          // A media directory is a gallery, not a list of rows.
          !(fieldSchema.type === "record" && fieldSchema.mediaType);
        if (isNestedList) {
          const hidden = hiddenLists[key] === true;
          return (
            <div key={key} className="flex flex-col gap-1">
              <div className="flex items-center gap-1 pl-2 min-h-6">
                <button
                  className="flex items-center gap-1 min-w-0 text-left"
                  aria-expanded={!hidden}
                  onClick={() =>
                    setHiddenLists((prev) => ({ ...prev, [key]: !hidden }))
                  }
                >
                  <ChevronRight
                    size={10}
                    className={cn(
                      "shrink-0 text-fg-secondary-alt transition-transform",
                      { "rotate-90": !hidden },
                    )}
                  />
                  <FieldLabel label={key} />
                </button>
                <div className="flex-1" />
                {!hidden && !fieldReadonly && (
                  <ListAddButton path={fieldPath} />
                )}
              </div>
              {fieldSchema.description && (
                <FieldDescription description={fieldSchema.description} inset />
              )}
              {!hidden && (
                <div className="pl-2">
                  <BlockList
                    path={fieldPath}
                    depth={depth + 1}
                    readonly={fieldReadonly}
                    showAdd={false}
                  />
                </div>
              )}
            </div>
          );
        }
        return (
          <div key={key} className="flex flex-col gap-0.5 pl-2">
            <FieldLabel label={key} />
            {fieldSchema.description && (
              <FieldDescription description={fieldSchema.description} />
            )}
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

/** A schema key, title-cased the way `Field` labels the same key elsewhere. */
function FieldLabel({ label }: { label: string }) {
  return (
    <span className="truncate text-xs font-medium leading-4 text-fg-secondary">
      {fromCamelToTitleCase(label)}
    </span>
  );
}

function FieldDescription({
  description,
  inset,
}: {
  description: string;
  /** Line it up with a label that has its own inset (a nested list's). */
  inset?: boolean;
}) {
  return (
    <span
      className={cn("text-[11px] leading-4 text-fg-tertiary", {
        "pl-2": inset,
      })}
    >
      {description}
    </span>
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
 *
 * A union row also shows which variant it is, because that is the first thing
 * you need to know about a collapsed block.
 */
function RowSummary({
  path,
  unionKey,
  muted,
}: {
  path: SourcePath;
  unionKey?: string;
  /** Beside a record's key, which is the row's label: the summary is second. */
  muted?: boolean;
}) {
  const preview = useRefPreview(path);
  const sourceAtPath = useSourceAtPath(path);
  const source =
    "data" in sourceAtPath && sourceAtPath.data !== undefined
      ? sourceAtPath.data
      : undefined;
  const tag = useMemo(() => {
    if (
      unionKey === undefined ||
      source === undefined ||
      source === null ||
      typeof source !== "object"
    ) {
      return null;
    }
    const value = Object.entries(source).find(([key]) => key === unionKey);
    return typeof value?.[1] === "string" ? value[1] : null;
  }, [source, unionKey]);
  const summary = useMemo(() => {
    if (preview?.title) {
      return preview.title;
    }
    if (source !== undefined) {
      return firstStringOf(source, unionKey);
    }
    return null;
  }, [preview, source, unionKey]);
  return (
    <>
      {tag !== null && (
        <span className="shrink-0 rounded bg-bg-secondary px-1.5 py-0.5 text-xs text-fg-secondary">
          {tag}
        </span>
      )}
      <span
        className={cn(
          "flex-1 min-w-0 truncate text-sm",
          muted ? "text-fg-secondary" : "text-fg-primary",
        )}
      >
        {summary ?? ""}
      </span>
    </>
  );
}

/**
 * Depth-first first string in a source — a cheap stand-in for a title when the
 * schema has no `preview`. Skips the keys that are structure rather than
 * content: a union's discriminator (whatever it is called), and a rich text
 * node's `tag`, which would otherwise title a whole text block "p".
 */
function firstStringOf(source: Json, unionKey?: string): string | null {
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
      if (
        key === "type" ||
        key === "_type" ||
        key === "tag" ||
        key === unionKey
      ) {
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

const MENU_TRIGGER =
  "shrink-0 rounded p-1 text-fg-secondary hover:text-fg-primary hover:bg-bg-secondary-hover";
const MENU_ITEM =
  "flex h-7 w-full items-center justify-start gap-2 rounded px-2 text-sm font-normal text-fg-primary hover:bg-bg-secondary-hover";
const ADD_BUTTON =
  "flex h-6 items-center gap-1 rounded px-1 text-xs font-normal text-fg-tertiary hover:bg-transparent hover:text-fg-primary";

function ArrayRowMenu({
  onInsertAbove,
  onInsertBelow,
  onDelete,
  onDuplicate,
}: {
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const portalContainer = useValPortal();
  const [open, setOpen] = useState(false);
  // Every item closes the menu: each one changes the list, and the menu's
  // row may not even be the same item afterwards.
  const item = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={MENU_TRIGGER} aria-label="Row actions">
        <EllipsisVertical size={16} />
      </PopoverTrigger>
      <PopoverContent
        className="flex w-auto flex-col p-1"
        container={portalContainer}
        side="top"
      >
        {/* The same inserts as the bars in the gaps, for keyboard and
            screen-reader users and anyone who never hovers a gap. */}
        <button className={MENU_ITEM} onClick={item(onInsertAbove)}>
          <BetweenHorizontalStart className="w-3.5 h-3.5" />
          <span>Add above</span>
        </button>
        <button className={MENU_ITEM} onClick={item(onInsertBelow)}>
          <BetweenHorizontalEnd className="w-3.5 h-3.5" />
          <span>Add below</span>
        </button>
        <button className={MENU_ITEM} onClick={item(onDuplicate)}>
          <Copy className="w-3.5 h-3.5" />
          <span>Duplicate</span>
        </button>
        <button className={MENU_ITEM} onClick={item(onDelete)}>
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A record entry's menu. The actions are the record popovers the module
 * header uses, each asking for the key it needs; what is ALLOWED (a fixed
 * route cannot be renamed, a referenced entry cannot be deleted) is
 * `useArrayAndRecordTools`'s, so this menu and the header cannot disagree.
 */
function RecordRowMenu({ path }: { path: SourcePath }) {
  const portalContainer = useValPortal();
  const [open, setOpen] = useState(false);
  const { entry } = useArrayAndRecordTools(path);
  if (
    entry === null ||
    !(entry.canChange || entry.canDuplicate || entry.canDelete)
  ) {
    return null;
  }
  const close = () => setOpen(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={MENU_TRIGGER}
        aria-label={`Actions for ${entry.key}`}
      >
        <EllipsisVertical size={16} />
      </PopoverTrigger>
      <PopoverContent
        className="flex w-auto flex-col p-1"
        container={portalContainer}
        side="top"
      >
        {entry.canChange && (
          <ChangeRecordPopover
            defaultValue={entry.key}
            parentPath={entry.parentPath}
            variant="ghost"
            size="sm"
            className={MENU_ITEM}
            routePattern={entry.routePattern}
            references={entry.references}
            keyDescription={entry.keyDescription}
            onComplete={close}
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>{entry.routePattern ? "Change URL" : "Rename"}</span>
          </ChangeRecordPopover>
        )}
        {entry.canDuplicate && (
          <DuplicateRecordPopover
            defaultValue={entry.key}
            parentPath={entry.parentPath}
            variant="ghost"
            size="sm"
            className={MENU_ITEM}
            routePattern={entry.routePattern}
            keyDescription={entry.keyDescription}
            onComplete={close}
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Duplicate</span>
          </DuplicateRecordPopover>
        )}
        {entry.canDelete && (
          <DeleteRecordPopover
            path={path}
            parentPath={entry.parentPath}
            variant="ghost"
            size="sm"
            className={MENU_ITEM}
            references={entry.references}
            confirmationMessage={`This will delete the ${entry.key} record.`}
            onComplete={close}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </DeleteRecordPopover>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The Add for a list, wherever it is drawn: under a top-level list, or on the
 * label row of a nested one. An array appends an empty item in place; a record
 * first needs a key, so it opens the same key form as the module header's +.
 */
function ListAddButton({ path }: { path: SourcePath }) {
  const schemaAtPath = useSchemaAtPath(path);
  if (schemaAtPath.status !== "success") {
    return null;
  }
  if (schemaAtPath.data.type === "record") {
    return <RecordAddButton path={path} />;
  }
  if (schemaAtPath.data.type === "array") {
    return <ArrayAddButton path={path} schema={schemaAtPath.data} />;
  }
  return null;
}

function ArrayAddButton({
  path,
  schema,
}: {
  path: SourcePath;
  schema: SerializedArraySchema;
}) {
  const emptyOf = useEmptyOf();
  const { addPatch, patchPath } = useAddPatch(path);
  const shallowSourceAtPath = useShallowSourceAtPath(path, "array");
  if (!("data" in shallowSourceAtPath) || !shallowSourceAtPath.data) {
    return null;
  }
  const length = shallowSourceAtPath.data.length;
  return (
    <button
      className={ADD_BUTTON}
      onClick={() => {
        addPatch(
          [
            {
              op: "add",
              path: patchPath.concat(length.toString()),
              value: emptyOf(schema.item) as JSONValue,
            },
          ],
          "array",
        );
      }}
    >
      <Plus size={12} />
      <span>Add</span>
    </button>
  );
}

function RecordAddButton({ path }: { path: SourcePath }) {
  const { add } = useArrayAndRecordTools(path);
  if (add === null || !add.canAdd) {
    return null;
  }
  return (
    <AddRecordPopover
      path={path}
      variant="ghost"
      size="sm"
      className={ADD_BUTTON}
      routePattern={add.routePattern}
      keyDescription={add.keyDescription}
    >
      <Plus size={12} />
      <span>Add</span>
    </AddRecordPopover>
  );
}
