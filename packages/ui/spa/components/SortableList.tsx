import { useEffect, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
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
import { EllipsisVertical, GripVertical } from "lucide-react";
import {
  JsonArray,
  SourcePath,
  SerializedArraySchema,
  Json,
  SerializedSchema,
  Internal,
} from "@valbuild/core";
import { Preview } from "./Preview";

export function SortableList({
  source,
  path,
  schema,
}: {
  source: JsonArray;
  path: SourcePath;
  schema: SerializedArraySchema;
}) {
  const [items, setItems] = useState<
    { source: Json; path: SourcePath; id: number }[]
  >([]);
  useEffect(() => {
    const items: {
      source: Json;
      path: SourcePath;
      id: number;
    }[] = [];
    let id = 1; // NB: starts 1 - 0 doesn't work with DndKit (???) plus we want to show 1-based index
    for (const item of source) {
      const itemPath = Internal.createValPathOfItem(path, id);
      if (!itemPath) {
        console.error("Val: could not determine path of item", path, id);
        id++;
        continue;
      }
      items.push({ source: item, path: itemPath, id });
      id++;
    }
    setItems(items);
  }, [source, path]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const [disabled, setDisabled] = useState(false);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div className="grid grid-cols-[min-content,min-content,1fr,min-content] gap-4">
          {items.map(({ source, path, id }) => {
            return (
              <SortableItem
                key={id}
                id={id}
                source={source}
                schema={schema.item}
                path={path}
                disabled={disabled}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (active?.id !== over?.id) {
      setDisabled(true);
      setItems((items) => {
        const oldIndex = items.findIndex(
          (item) => item.id === Number(active?.id)
        );
        const newIndex = items.findIndex(
          (item) => item.id === Number(over?.id)
        );

        return arrayMove(items, oldIndex, newIndex);
      });
      setTimeout(() => {
        setDisabled(false);
      }, 500);
    }
  }
}

export function SortableItem({
  id,
  source,
  schema,
  disabled,
}: {
  id: number;
  source: Json;
  path: SourcePath;
  schema: SerializedSchema;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: id, disabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="grid items-center col-span-4 gap-4 grid-cols-subgrid"
    >
      <div
        {...attributes}
        {...listeners}
        className={classNames({
          "opacity-30": disabled,
        })}
      >
        <GripVertical />
      </div>
      <div className="font-serif text-accent">{formatNumber(id)}</div>
      <div className="p-4 border rounded border-border bg-card">
        <Preview source={source} schema={schema} />
      </div>
      <button>
        <EllipsisVertical />
      </button>
    </div>
  );
}

function formatNumber(n: number) {
  return n.toString().padStart(2, "0");
}
