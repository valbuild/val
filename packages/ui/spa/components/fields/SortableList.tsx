import { useEffect, useRef, useState } from "react";
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
import { EllipsisVertical, GripVertical, Trash2 } from "lucide-react";
import {
  JsonArray,
  SourcePath,
  SerializedArraySchema,
  Json,
  SerializedSchema,
  Internal,
} from "@valbuild/core";
import { Preview } from "./Preview";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@radix-ui/react-dropdown-menu";
import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "../ui/dropdown-menu";

export function SortableList({
  source,
  path,
  schema,
  loading,
  onClick,
  onMove,
  onDelete,
}: {
  source: JsonArray;
  path: SourcePath;
  schema: SerializedArraySchema;
  loading: boolean;
  onMove: (from: number, to: number) => Promise<void>;
  onClick: (path: SourcePath) => void;
  onDelete: (item: number) => Promise<void>;
}) {
  const [disabled, setDisabled] = useState<boolean>(false);
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
      const itemPath = Internal.createValPathOfItem(path, id - 1);
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
                disabled={loading || disabled}
                onClick={onClick}
                onDelete={(id) => {
                  setDisabled(true);
                  onDelete(
                    id -
                      1 /* id is 1-based because dnd kit didn't work with 0 based - surely we're doing something strange... (??) */
                  )
                    .then(() => {
                      setItems((items) => {
                        return items.filter((item) => item.id !== id);
                      });
                    })
                    .finally(() => {
                      setDisabled(false);
                    });
                }}
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
      const oldIndex = items.findIndex(
        (item) => item.id === Number(active?.id)
      );
      const newIndex = items.findIndex((item) => item.id === Number(over?.id));
      const prevItems = items.slice();
      setItems((items) => {
        return arrayMove(items, oldIndex, newIndex);
      });
      onMove(oldIndex, newIndex)
        .catch(() => {
          setItems(prevItems);
        })
        .then(() => {
          setItems((items) => {
            return items.map((item, i) => {
              const itemPath = Internal.createValPathOfItem(path, i);
              if (!itemPath) {
                throw Error(
                  "Val: could not determine path of item: " + path + " i:" + i
                );
              }

              return { ...item, path: itemPath, id: i + 1 };
            });
          });
        })
        .finally(() => {
          setDisabled(false);
        });
    }
  }
}

export const LIST_ITEM_MAX_HEIGHT = 170;

export function SortableItem({
  id,
  path,
  source,
  schema,
  disabled,
  onClick,
  onDelete,
}: {
  id: number;
  source: Json;
  path: SourcePath;
  schema: SerializedSchema;
  disabled: boolean;
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
  }, [id, source]);
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
      className="grid items-start col-span-4 gap-4 grid-cols-subgrid disabled:opacity-55"
    >
      <button
        {...attributes}
        {...listeners}
        className={classNames("pt-4", {
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
        className="pt-4 font-serif text-accent"
        disabled={disabled}
        onClick={() => {
          onClick(path);
        }}
      >
        {formatNumber(id)}
      </button>
      <button
        className="relative grid p-4 overflow-hidden border rounded border-border bg-card gap-y-2 grid-cols-subgrid cols-span-1"
        style={{
          maxHeight: LIST_ITEM_MAX_HEIGHT,
        }}
        ref={ref}
        disabled={disabled}
        onClick={() => {
          onClick(path);
        }}
      >
        <Preview source={source} schema={schema} />
        {isTruncated && (
          <div
            className="absolute bottom-0 left-0 w-full bg-gradient-to-b via-50% from-transparent via-card/90 to-card"
            style={{ height: 40 }}
          ></div>
        )}
      </button>
      <button className="pt-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <EllipsisVertical />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-32">
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  onDelete(id);
                }}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </button>
    </div>
  );
}

function formatNumber(n: number) {
  return n.toString().padStart(2, "0");
}
