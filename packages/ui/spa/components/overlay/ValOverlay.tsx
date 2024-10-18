import classNames from "classnames";
import { Eye, Play, Search, Upload } from "lucide-react";
import { useState } from "react";

export type ValOverlayProps = {
  draftMode: boolean;
  setDraftMode: (draftMode: boolean) => void;
  disableOverlay: () => void;
};

type DropZones =
  | "val-menu-left-top"
  | "val-menu-left-center"
  | "val-menu-left-bottom"
  | "val-menu-center-top"
  | "val-menu-center-bottom"
  | "val-menu-right-top"
  | "val-menu-right-center"
  | "val-menu-right-bottom";

export function ValOverlay() {
  return <DraggableValMenu />;
}

function ValMenu({
  dropZone,
  ghost,
}: {
  dropZone: DropZones;
  ghost?: boolean;
}) {
  const dir =
    dropZone === "val-menu-right-center" || dropZone === "val-menu-left-center"
      ? "vertical"
      : "horizontal";
  return (
    <div className="p-4 ">
      <div
        className={classNames(
          "flex relative rounded bg-bg-primary text-text-primary gap-4",
          {
            "flex-col py-4 px-2": dir === "vertical",
            "flex-row px-4 py-2": dir === "horizontal",
            "opacity-70": ghost,
          },
        )}
      >
        <button className="">
          <Eye size={24} />
        </button>
        <button>
          <Search size={24} />
        </button>
        <button>
          <Upload size={24} />
        </button>
      </div>
    </div>
  );
}

function DraggableValMenu() {
  const [isDragging, setIsDragging] = useState(false);
  const [dropZone, setDropZone] = useState<DropZones>("val-menu-right-center");
  const [dragOverDropZone, setDragOverDropZone] = useState<DropZones | null>(
    null,
  );
  const onDrop = (id: DropZones) => (event: React.DragEvent) => {
    event.preventDefault();
    setDropZone(id);
  };
  const onDragOver = (id: DropZones) => (event: React.DragEvent) => {
    event.preventDefault();
    setDragOverDropZone(id);
  };

  return (
    <>
      <div
        className={classNames("z-overlay", getPositionClassName(dropZone))}
        draggable
        onDragStart={() => {
          setIsDragging(true);
        }}
        onDragEnd={() => {
          setIsDragging(false);
        }}
      >
        <ValMenu dropZone={dropZone} />
      </div>
      {isDragging && (
        <>
          {dragOverDropZone && dragOverDropZone !== dropZone && (
            <div
              className={classNames(
                "z-[3]",
                getPositionClassName(dragOverDropZone),
              )}
              onDrop={onDrop(dragOverDropZone)}
              onDragOver={onDragOver(dragOverDropZone)}
            >
              <ValMenu dropZone={dragOverDropZone} ghost />
            </div>
          )}
          <div className="fixed top-0 left-0 grid w-screen h-screen grid-cols-3 grid-rows-3 z-[2]">
            <DropZone
              id="val-menu-left-top"
              dropZone={dropZone}
              dragOverDropZone={dragOverDropZone}
              onDrop={onDrop}
              onDragOver={onDragOver}
            ></DropZone>
            <DropZone
              id="val-menu-center-top"
              dropZone={dropZone}
              dragOverDropZone={dragOverDropZone}
              onDrop={onDrop}
              onDragOver={onDragOver}
            ></DropZone>
            <DropZone
              id="val-menu-right-top"
              dropZone={dropZone}
              dragOverDropZone={dragOverDropZone}
              onDrop={onDrop}
              onDragOver={onDragOver}
            ></DropZone>
            <DropZone
              id="val-menu-left-center"
              dropZone={dropZone}
              dragOverDropZone={dragOverDropZone}
              onDrop={onDrop}
              onDragOver={onDragOver}
            ></DropZone>
            <div></div>
            <DropZone
              id="val-menu-right-center"
              dropZone={dropZone}
              dragOverDropZone={dragOverDropZone}
              onDrop={onDrop}
              onDragOver={onDragOver}
            ></DropZone>
            <DropZone
              id="val-menu-left-bottom"
              dropZone={dropZone}
              dragOverDropZone={dragOverDropZone}
              onDrop={onDrop}
              onDragOver={onDragOver}
            ></DropZone>
            <DropZone
              id="val-menu-center-bottom"
              dropZone={dropZone}
              dragOverDropZone={dragOverDropZone}
              onDrop={onDrop}
              onDragOver={onDragOver}
            ></DropZone>
            <DropZone
              id="val-menu-right-bottom"
              dropZone={dropZone}
              dragOverDropZone={dragOverDropZone}
              onDrop={onDrop}
              onDragOver={onDragOver}
            ></DropZone>
          </div>
        </>
      )}
    </>
  );
}

function getPositionClassName(dropZone: DropZones) {
  return classNames("fixed transform", {
    "left-0 top-0": dropZone === "val-menu-left-top",
    "left-0 top-1/2 -translate-y-1/2": dropZone === "val-menu-left-center",
    "left-0 bottom-0": dropZone === "val-menu-left-bottom",
    "left-1/2 -translate-x-1/2 top-0": dropZone === "val-menu-center-top",
    "left-1/2 -translate-x-1/2 bottom-0": dropZone === "val-menu-center-bottom",
    "right-0 top-0": dropZone === "val-menu-right-top",
    "right-0 top-1/2 -translate-y-1/2": dropZone === "val-menu-right-center",
    "right-0 bottom-0": dropZone === "val-menu-right-bottom",
  });
}

const DropZone = ({
  id,
  onDrop,
  onDragOver,
}: {
  id: DropZones;
  onDrop: (id: DropZones) => (event: React.DragEvent) => void;
  onDragOver: (id: DropZones) => (event: React.DragEvent) => void;
  dropZone: DropZones;
  dragOverDropZone: DropZones | null;
}) => {
  return <div onDrop={onDrop(id)} onDragOver={onDragOver(id)}></div>;
};
