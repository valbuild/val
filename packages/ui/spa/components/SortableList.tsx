import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
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
import { SourcePath, SerializedArraySchema } from "@valbuild/core";
import type { ListArrayRender } from "@valbuild/core";
import { PreviewWithRender } from "./PreviewWithRender";
import { StringField } from "./fields/StringField";
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
import { FieldValidationError } from "./FieldValidationError";

export function SortableList({
  source,
  render,
  path,
  schema,
  disabled,
  onClick,
  onMove,
  onDelete,
  onDuplicate,
}: {
  source: SourcePath[];
  path: SourcePath;
  disabled?: boolean;
  render?: ListArrayRender;
  schema: SerializedArraySchema;
  onMove: (from: number, to: number) => void;
  onClick: (path: SourcePath) => void;
  onDelete: (item: number) => void;
  onDuplicate: (item: number) => void;
}) {
  const [items, setItems] = useState<{ path: SourcePath; id: number }[]>([]);
  useEffect(() => {
    const items: {
      path: SourcePath;
      id: number;
    }[] = [];
    let id = 1; // NB: starts 1 - 0 doesn't work with DndKit (???) plus we want to show 1-based index
    for (const path of source) {
      items.push({ path: path, id });
      id++;
    }
    setItems(items);
  }, [source, path]);

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
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
        setItems((items) => {
          return arrayMove(items, oldIndex, newIndex);
        });
        onMove(oldIndex, newIndex); // DndKit is 1-based, we're 0-based
      }
    },
    [items],
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items}
        strategy={verticalListSortingStrategy}
        disabled={disabled}
      >
        <div className="flex flex-col gap-y-4 w-full">
          {items.map(({ path, id }) => {
            return (
              <SortableItem
                key={id}
                id={id}
                schema={schema}
                disabled={disabled}
                renderLayout={render?.layout}
                render={
                  /* id is 1-based because dnd kit didn't work with 0 based - surely we're doing something strange... (??) */
                  render?.items[id - 1]
                }
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
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}

export const LIST_ITEM_MAX_HEIGHT = 170;

export function SortableItem({
  id,
  path,
  schema,
  disabled,
  render,
  onClick,
  onDelete,
  onDuplicate,
}: {
  id: number;
  path: SourcePath;
  renderLayout?: "list";
  render?: ListArrayRender["items"][number];
  schema: SerializedArraySchema;
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
      touch-action="manipulation"
      ref={setNodeRef}
      style={style}
      className={cn("relative flex disabled:opacity-55 flex-1", {
        "items-start": !centerGripAndDeleteIcons,
        "items-center": centerGripAndDeleteIcons,
      })}
    >
      <button
        {...attributes}
        {...listeners}
        className={cn("pb-1 pr-2", {
          "opacity-30": disabled,
          "mt-2.5": !centerGripAndDeleteIcons,
        })}
        disabled={disabled}
        onClick={() => {
          onClick(path);
        }}
      >
        <GripVertical />
      </button>
      {/** Changing this behavior means we need to change the getNavPath behavior */}
      {!render && schema?.item?.type === "string" && (
        <div
          className={cn("flex-grow w-full", {
            "p-2 border border-bg-error-secondary rounded-lg":
              !!validationErrors[path],
          })}
        >
          <StringField path={path} />
          {validationErrors[path] && (
            <div className="px-2">
              <FieldValidationError validationErrors={validationErrors[path]} />
            </div>
          )}
        </div>
      )}
      {(render || schema?.item?.type !== "string") && (
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
          <PreviewWithRender path={path} className="flex-grow p-4 w-full" />
          {isTruncated && (
            <div
              className="absolute bottom-0 left-0 w-full bg-gradient-to-b via-50% from-transparent via-card/90 to-card"
              style={{ height: 40 }}
            ></div>
          )}
        </button>
      )}
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
