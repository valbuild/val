import classNames from "classnames";
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
      <div className="fixed top-0 left-0 grid w-screen h-screen grid-cols-3 grid-rows-3 z-[5]">
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
  );
}

const DropZone = ({
  id,
  onDrop,
  onDragOver,
  dropZone,
  dragOverDropZone,
}: {
  id: DropZones;
  onDrop: (id: DropZones) => (event: React.DragEvent) => void;
  onDragOver: (id: DropZones) => (event: React.DragEvent) => void;
  dropZone: DropZones;
  dragOverDropZone: DropZones | null;
}) => {
  const dir =
    id === "val-menu-right-center" || id === "val-menu-left-center"
      ? "vertical"
      : "horizontal";

  let className = "p-4";
  if (id === "val-menu-left-top") {
    className += classNames(
      className,
      "flex justify-start items-start bg-red-100",
    );
  } else if (id === "val-menu-left-center") {
    className += classNames(
      className,
      "flex justify-start items-center bg-red-200",
    );
  } else if (id === "val-menu-left-bottom") {
    className += classNames(
      className,
      "flex justify-start items-end bg-red-300",
    );
  } else if (id === "val-menu-center-top") {
    className += classNames(
      className,
      "flex justify-center items-start bg-red-400",
    );
  } else if (id === "val-menu-center-bottom") {
    className += classNames(
      className,
      "flex justify-center items-end bg-red-500",
    );
  } else if (id === "val-menu-right-top") {
    className += classNames(
      className,
      "flex justify-end items-start bg-red-600",
    );
  } else if (id === "val-menu-right-center") {
    className += classNames(
      className,
      "flex justify-end items-center bg-red-700",
    );
  } else if (id === "val-menu-right-bottom") {
    className += classNames(className, "flex justify-end items-end bg-red-800");
  } else {
    const _exhaustiveCheck: never = id;
    console.error('Unexpected drop zone: "', _exhaustiveCheck, '"');
  }
  return (
    <div onDrop={onDrop(id)} onDragOver={onDragOver(id)} className={className}>
      {dragOverDropZone === id && dropZone !== id && (
        <ValMenuContainer dir={dir} id={id} ghost />
      )}
      {dropZone === id && <ValMenuContainer dir={dir} id={id} />}
    </div>
  );
};

function ValMenuContainer({
  dir,
  ghost,
  id,
}: {
  dir: "horizontal" | "vertical";
  ghost?: boolean;
  id: DropZones;
}) {
  let className = "";
  if (dir === "horizontal") {
    className = classNames(className, "w-40 h-10");
  } else if (dir === "vertical") {
    className = classNames(className, "w-10 h-40");
  }

  if (id.startsWith("val-menu-left-")) {
    className = classNames(className, "left-0");
  } else if (id.startsWith("val-menu-right-")) {
    className = classNames(className, "right-0");
  } else if (id.startsWith("val-menu-center-")) {
    className = classNames(className, "left-1/2 transform -translate-x-1/2");
  }
  if (id.endsWith("-top")) {
    className = classNames(className, "top-0");
  } else if (id.endsWith("-bottom")) {
    className = classNames(className, "bottom-0");
  } else if (id.endsWith("-center")) {
    className = classNames(className, "top-1/2 transform -translate-y-1/2");
  }
  if (ghost) {
    className = classNames(className, "bg-slate-200");
  } else {
    className = classNames(className, "bg-slate-700");
  }
  return (
    <div className="relative">
      <div
        className={classNames(className, "absolute")}
        draggable={!ghost}
      ></div>
    </div>
  );
}
