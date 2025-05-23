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
import {
  SourcePath,
  SerializedArraySchema,
  ListArrayPreview,
  ImageSource,
  Internal,
  ImageMetadata,
  RemoteSource,
  VAL_EXTENSION,
} from "@valbuild/core";
import { Preview as AutoPreview } from "./Preview";
import { StringField } from "./fields/StringField";
import { isParentError } from "../utils/isParentError";
import { ErrorIndicator } from "./ErrorIndicator";
import { useAllValidationErrors } from "./ValProvider";

export function SortableList({
  source,
  preview,
  path,
  schema,
  disabled,
  onClick,
  onMove,
  onDelete,
}: {
  source: SourcePath[];
  path: SourcePath;
  disabled?: boolean;
  preview?: ListArrayPreview;
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
      <SortableContext
        items={items}
        strategy={verticalListSortingStrategy}
        disabled={disabled}
      >
        <div className="flex flex-col w-full gap-y-4">
          {items.map(({ path, id }) => {
            return (
              <SortableItem
                key={id}
                id={id}
                schema={schema}
                disabled={disabled}
                previewLayout={preview?.layout}
                preview={
                  /* id is 1-based because dnd kit didn't work with 0 based - surely we're doing something strange... (??) */
                  preview?.items[id - 1]
                }
                path={path}
                onClick={onClick}
                onDelete={(id) => {
                  onDelete(
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
  preview,
  onClick,
  onDelete,
}: {
  id: number;
  path: SourcePath;
  previewLayout?: "list";
  preview?: ListArrayPreview["items"][number];
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
  const validationErrors = useAllValidationErrors() || {};
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const centerGripAndDeleteIcons = true; // previewLayout === "list";
  return (
    <div
      touch-action="manipulation"
      ref={setNodeRef}
      style={style}
      className={classNames("flex disabled:opacity-55 flex-1", {
        "items-start": !centerGripAndDeleteIcons,
        "items-center": centerGripAndDeleteIcons,
      })}
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
        className="pt-2 my-1 mr-2 -ml-1 font-serif text-accent"
        disabled={disabled}
        onClick={() => {
          onClick(path);
        }}
      >
        {formatNumber(id)}
      </button>
      {/** Changing this behavior means we need to change the getNavPath behavior */}
      {!preview && schema?.item?.type === "string" && (
        <div className="flex-grow w-full">
          <StringField path={path} />
        </div>
      )}
      {(preview || schema?.item?.type !== "string") && (
        <button
          className={classNames(
            "flex-grow",
            "relative flex text-left border rounded-lg border-border bg-card gap-y-2 bg-bg-primary",
            "hover:bg-bg-secondary_subtle",
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
          {preview && <ListPreviewItem {...preview} />}
          {!preview && (
            <div className="flex-grow w-full p-4">
              <AutoPreview path={path} />
            </div>
          )}
          {isTruncated && (
            <div
              className="absolute bottom-0 left-0 w-full bg-gradient-to-b via-50% from-transparent via-card/90 to-card"
              style={{ height: 40 }}
            ></div>
          )}
        </button>
      )}
      <button
        className={classNames("flex gap-x-2", {
          "items-start pt-4": !centerGripAndDeleteIcons,
          "items-center": centerGripAndDeleteIcons,
        })}
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

function ListPreviewItem({
  title,
  image,
  subtitle,
}: ListArrayPreview["items"][number]) {
  return (
    <div
      className={classNames(
        "flex w-full items-center justify-between pl-4 flex-grow",
      )}
    >
      <div className="flex flex-col flex-shrink py-4 overflow-x-clip">
        <div className="text-lg font-medium">{title}</div>
        {subtitle && (
          <div className="flex-shrink block overflow-hidden text-sm text-gray-500 text-ellipsis max-h-5">
            {subtitle}
          </div>
        )}
      </div>
      {image && <ImageOrPlaceholder src={image} alt={title} />}
    </div>
  );
}

function ImageOrPlaceholder({
  src,
  alt,
}: {
  src: ImageSource | RemoteSource<ImageMetadata> | null | undefined;
  alt: string;
}) {
  const [isLoaded, setIsLoaded] = useState(false);

  if (src === null || src === undefined) {
    return (
      <div className="flex-shrink-0 w-20 h-20 ml-4 opacity-25 bg-bg-brand-secondary"></div>
    );
  }

  const imageUrl =
    src[VAL_EXTENSION] === "file"
      ? Internal.convertFileSource(src).url
      : Internal.convertRemoteSource(src).url;

  return (
    <div className="relative flex-shrink-0 w-20 h-20 ml-4">
      {!isLoaded && (
        <div className="absolute inset-0 opacity-25 bg-bg-brand-secondary animate-in"></div>
      )}
      <img
        src={imageUrl}
        alt={alt}
        onLoad={() => setIsLoaded(true)}
        onError={() => setIsLoaded(false)}
        className={`absolute inset-0 object-cover w-full h-full rounded-r-lg ${isLoaded ? "opacity-100" : "opacity-0"}`}
        style={{
          objectPosition: src.metadata?.hotspot
            ? `${src.metadata.hotspot.x}% ${src.metadata.hotspot.y}%`
            : "",
          transition: "opacity 0.2s ease-in-out",
        }}
      />
    </div>
  );
}

function formatNumber(n: number) {
  return (
    // DnD kit is 1-based
    (n - 1).toString()
  );
}
