import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { DragEndEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Copy, EllipsisVertical, GripVertical, Trash2 } from "lucide-react";
import { SourcePath } from "@valbuild/core";
import { RefPreview } from "./RefPreview";
import { isParentError } from "../utils/isParentError";
import { ErrorIndicator } from "./ErrorIndicator";
import { useAllValidationErrors } from "./ValErrorProvider";
import { useValPortal } from "./ValPortalProvider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./designSystem/popover";
import { cn } from "./designSystem/cn";
import { DRAG_HANDLE_TOUCH, SORTABLE_ROW_TOUCH } from "./dragHandle";
import { LocaleFiltered } from "./LocaleFilterProvider";

export function SortableContainer({
  source,
  disabled,
  onMove,
  renderItem,
  className,
}: {
  source: SourcePath[];
  disabled?: boolean;
  onMove: (from: number, to: number) => void;
  renderItem: (item: {
    path: SourcePath;
    id: number;
    index: number;
  }) => React.ReactNode;
  className?: string;
}) {
  /**
   * The rendered order, which is `source`'s order plus a transient optimistic lie.
   *
   * ## Why this is re-derived from `source`, and must stay that way
   *
   * An array item's path is POSITIONAL (`?p="0"`, `?p="1"`), so a reorder does not
   * move paths — it moves content between fixed paths. `handleDragEnd` permutes
   * these entries for immediate feedback, and that permutation has to be undone
   * the moment the patch applies, or it is applied a second time and cancels the
   * move out.
   *
   * Measured, because it is not obvious and it looks like churn worth removing:
   * with this reset suppressed for a reorder (paths compared as a set, which is
   * what "the list owns its order" amounts to), dragging row 1 below row 2 ends
   * with the list showing its ORIGINAL order. The patch is correct, source is
   * correct, and the drag silently does nothing.
   *
   * So this is not the controlled/uncontrolled question that text fields answer
   * with `defaultValue`. A text field owns a value at a fixed path; a list row
   * owns nothing — its path is its index.
   */
  const [items, setItems] = useState<{ path: SourcePath; id: number }[]>([]);
  useEffect(() => {
    const nextItems: {
      path: SourcePath;
      id: number;
    }[] = [];
    let id = 1; // NB: starts 1 - 0 doesn't work with DndKit (???) plus we want to show 1-based index
    for (const path of source) {
      nextItems.push({ path: path, id });
      id++;
    }
    setItems(nextItems);
  }, [source]);

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

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (active?.id !== over?.id) {
        const oldIndex = items.findIndex(
          (item) => item.id === Number(active?.id),
        );
        const newIndex = items.findIndex(
          (item) => item.id === Number(over?.id),
        );
        setItems((prev) => {
          return arrayMove(prev, oldIndex, newIndex);
        });
        onMove(oldIndex, newIndex);
      }
      setActiveId(null);
    },
    [items, onMove],
  );
  return (
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
        disabled={disabled}
      >
        <div className={className ?? "flex flex-col gap-y-4 w-full"}>
          {items.map(({ path, id }, index) => (
            <div
              key={id}
              style={{ opacity: id === activeId ? 0.3 : undefined }}
            >
              {renderItem({ path, id, index })}
            </div>
          ))}
        </div>
      </SortableContext>
      {/*
       * No drop animation, deliberately.
       *
       * The overlay renders a positional path, so while it animates back into
       * place the patch lands and the content AT that path changes — the card
       * under the cursor turns into a different row. Removing the animation
       * unmounts it at drop instead, before there is anything to change.
       */}
      <DragOverlay dropAnimation={null}>
        {activeItem
          ? renderItem({
              path: activeItem.path,
              id: activeItem.id,
              index: items.indexOf(activeItem),
            })
          : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * A list of rows you click through to, each showing its item's preview.
 *
 * The other kind of list is `BlockList`, which edits its items in place;
 * `ArrayFields` picks between the two on the item schema (`isInlineRender`).
 * This one is now only ever the preview-row half of that choice, so it takes no
 * schema: a row resolves its own preview through `RefPreview`.
 */
export function SortableList({
  source,
  disabled,
  onClick,
  onMove,
  onDelete,
  onDuplicate,
}: {
  source: SourcePath[];
  path: SourcePath;
  disabled?: boolean;
  onMove: (from: number, to: number) => void;
  onClick: (path: SourcePath) => void;
  onDelete: (item: number) => void;
  onDuplicate: (item: number) => void;
}) {
  return (
    <SortableContainer
      source={source}
      disabled={disabled}
      onMove={onMove}
      renderItem={({ path, id }) => (
        <LocaleFiltered path={path}>
          <SortableItemRow
            id={id}
            disabled={disabled}
            path={path}
            onClick={onClick}
            onDelete={(id) => {
              onDelete(
                /* id is 1-based because dnd kit didn't work with 0 based - surely we're doing something strange... (??) */
                id - 1,
              );
            }}
            onDuplicate={(id) => {
              onDuplicate(
                /* id is 1-based because dnd kit didn't work with 0 based - surely we're doing something strange... (??) */
                id - 1,
              );
            }}
          />
        </LocaleFiltered>
      )}
    />
  );
}

export const LIST_ITEM_MAX_HEIGHT = 170;

export function SortableItemRow({
  id,
  path,
  disabled,
  onClick,
  onDelete,
  onDuplicate,
}: {
  id: number;
  path: SourcePath;
  disabled?: boolean;
  onClick: (path: SourcePath) => void;
  onDelete: (item: number) => void;
  onDuplicate: (item: number) => void;
}) {
  const portalContainer = useValPortal();
  const ref = useRef<HTMLButtonElement>(null);
  const [isTruncated, setIsTruncated] = useState<boolean>(false);
  useEffect(() => {
    if (ref.current) {
      const height = ref.current.getBoundingClientRect().height;
      if (height >= LIST_ITEM_MAX_HEIGHT) {
        setIsTruncated(true);
      } else {
        setIsTruncated(false);
      }
    }
  }, [id, path]);
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: id, disabled: disabled === true });
  const validationErrors = useAllValidationErrors() || {};
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const centerGripAndDeleteIcons = !(validationErrors[path]?.length > 0);
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative flex disabled:opacity-55 flex-1",
        // See `SORTABLE_ROW_TOUCH`.
        SORTABLE_ROW_TOUCH,
        {
          "items-start": !centerGripAndDeleteIcons,
          "items-center": centerGripAndDeleteIcons,
        },
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className={cn(
          "pb-1 pr-2 rounded-sm text-fg-secondary hover:text-fg-primary",
          // Keyboard reordering STARTS here — dnd-kit gives the handle
          // `tabIndex=0` — so it needs the same focus ring as every other
          // control, not the browser default.
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
          // See `DRAG_HANDLE_TOUCH`.
          DRAG_HANDLE_TOUCH,
          {
            "opacity-30": disabled,
            "mt-2.5": !centerGripAndDeleteIcons,
          },
        )}
        disabled={disabled}
        onClick={() => {
          onClick(path);
        }}
      >
        <GripVertical />
      </button>
      <button
        className={cn(
          "flex-grow",
          "relative flex text-left border rounded-lg border-border bg-card gap-y-2 bg-bg-primary",
          "hover:bg-bg-secondary-hover",
          "overflow-y-clip",
        )}
        style={{
          maxHeight: LIST_ITEM_MAX_HEIGHT,
        }}
        ref={ref}
        disabled={disabled}
        onClick={() => {
          onClick(path);
        }}
      >
        <RefPreview path={path} className="flex-grow w-full" />
        {isTruncated && (
          <div
            className="absolute bottom-0 left-0 w-full bg-gradient-to-b via-50% from-transparent via-card/90 to-card"
            style={{ height: 40 }}
          ></div>
        )}
      </button>
      {isParentError(path, validationErrors) && (
        <div
          className={cn("absolute right-3", {
            "top-2": centerGripAndDeleteIcons,
            "top-0": !centerGripAndDeleteIcons,
          })}
        >
          <ErrorIndicator />
        </div>
      )}
      <Popover>
        <PopoverTrigger
          className={cn(
            "flex hover:bg-bg-secondary-hover px-2 hover:rounded-lg",
            {
              "items-start mt-4": !centerGripAndDeleteIcons,
              "items-center py-2": centerGripAndDeleteIcons,
            },
          )}
        >
          <EllipsisVertical size={16} />
        </PopoverTrigger>
        <PopoverContent className="p-2" container={portalContainer} side="top">
          <button
            className={cn("flex items-center gap-x-2")}
            onClick={() => {
              onDelete(id);
            }}
          >
            <span>
              <Trash2 className="w-4 h-4" />
            </span>
            <span>Delete</span>
          </button>
          <button
            className={cn("flex items-center gap-x-2")}
            onClick={() => {
              onDuplicate(id);
            }}
          >
            <span>
              <Copy className="w-4 h-4" />
            </span>
            <span>Duplicate</span>
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
