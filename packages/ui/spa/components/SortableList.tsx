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
import classNames from "classnames";
import { GripVertical, Trash2 } from "lucide-react";
import { SourcePath, SerializedArraySchema } from "@valbuild/core";
import { Preview } from "./Preview";
import { StringField } from "./fields/StringField";
import { isParentError } from "../utils/isParentError";
import { ErrorIndicator } from "./ErrorIndicator";
import { useErrors } from "./ValProvider";

export function SortableList({
  source,
  path,
  schema,
  onClick,
  onMove,
  onDelete,
}: {
  source: SourcePath[];
  path: SourcePath;
  schema: SerializedArraySchema;
  onMove: (from: number, to: number) => void;
  onClick: (path: SourcePath) => void;
  onDelete: (item: number) => void;
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
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div className="grid grid-cols-[min-content,min-content,1fr,min-content] gap-4">
          {items.map(({ path, id }) => {
            return (
              <SortableItem
                key={id}
                id={id}
                schema={schema}
                path={path}
                onClick={onClick}
                onDelete={(id) => {
                  onDelete(
                    id -
                      1 /* id is 1-based because dnd kit didn't work with 0 based - surely we're doing something strange... (??) */,
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
  onClick,
  onDelete,
}: {
  id: number;
  path: SourcePath;
  schema: SerializedArraySchema;
  disabled?: boolean;
  onClick: (path: SourcePath) => void;
  onDelete: (item: number) => void;
}) {
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
  const { validationErrors } = useErrors();
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      touch-action="manipulation"
      ref={setNodeRef}
      style={style}
      className="grid items-start col-span-4 gap-2 grid-cols-subgrid disabled:opacity-55"
    >
      <button
        {...attributes}
        {...listeners}
        className={classNames("pt-2 my-1", {
          "opacity-30": disabled,
        })}
        disabled={disabled}
        onClick={() => {
          onClick(path);
        }}
      >
        <GripVertical />
      </button>
      <button
        className="pt-2 my-1 font-serif text-accent"
        disabled={disabled}
        onClick={() => {
          onClick(path);
        }}
      >
        {formatNumber(id)}
      </button>
      {schema?.item?.type === "string" && <StringField path={path} />}
      {schema?.item?.type !== "string" && (
        <button
          className="relative grid p-4 overflow-hidden text-left border rounded border-border bg-card gap-y-2 grid-cols-subgrid cols-span-1"
          style={{
            maxHeight: LIST_ITEM_MAX_HEIGHT,
          }}
          ref={ref}
          disabled={disabled}
          onClick={() => {
            onClick(path);
          }}
        >
          <Preview path={path} />
          {isTruncated && (
            <div
              className="absolute bottom-0 left-0 w-full bg-gradient-to-b via-50% from-transparent via-card/90 to-card"
              style={{ height: 40 }}
            ></div>
          )}
        </button>
      )}
      <button
        className="flex items-center pt-4 gap-x-2"
        onClick={() => {
          onDelete(id);
        }}
      >
        {isParentError(path, validationErrors) ? (
          <ErrorIndicator />
        ) : (
          <div className="w-2 h-2" />
        )}
        <Trash2 className="w-4 h-4 mr-2" />
      </button>
    </div>
  );
}

function formatNumber(n: number) {
  return (
    "#" +
    // DnD kit is 1-based
    (n - 1).toString()
  );
}
