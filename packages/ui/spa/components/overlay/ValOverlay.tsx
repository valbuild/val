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
  const onDrop = (id: DropZones) => (event: React.DragEvent) => {
    event.preventDefault();
    setDropZone(id);
  };
  const onDragOver = (event: React.DragEvent) => {
    event.preventDefault();
  };
  return (
    <div>
      <div className="fixed top-0 left-0 z-50 grid w-1/3 h-screen grid-rows-3">
        <div
          className="w-full bg-red-500"
          onDrop={onDrop("val-menu-left-top")}
          onDragOver={onDragOver}
        >
          {dropZone === "val-menu-left-top" && <Test />}
        </div>
        <div
          className="w-full bg-red-300"
          onDrop={onDrop("val-menu-left-center")}
          onDragOver={onDragOver}
        >
          {dropZone === "val-menu-left-center" && <Test />}
        </div>
        <div
          className="w-full bg-red-400"
          onDrop={onDrop("val-menu-left-bottom")}
          onDragOver={onDragOver}
        >
          {dropZone === "val-menu-left-bottom" && <Test />}
        </div>
      </div>
      <div className="fixed top-0 z-50 grid w-1/3 h-screen grid-rows-3 left-1/3">
        <div
          className="w-full bg-blue-500"
          onDrop={onDrop("val-menu-center-top")}
          onDragOver={onDragOver}
        >
          {dropZone === "val-menu-center-top" && <Test />}
        </div>
        <div></div>
        <div
          className="w-full bg-green-400"
          onDrop={onDrop("val-menu-center-bottom")}
          onDragOver={onDragOver}
        >
          {dropZone === "val-menu-center-bottom" && <Test />}
        </div>
      </div>
      <div className="fixed top-0 right-0 z-50 grid w-1/3 h-screen grid-rows-3">
        <div
          className="w-full bg-red-500"
          onDrop={onDrop("val-menu-right-top")}
          onDragOver={onDragOver}
        >
          {dropZone === "val-menu-right-top" && <Test />}
        </div>
        <div
          className="w-full bg-red-300"
          onDrop={onDrop("val-menu-right-center")}
          onDragOver={onDragOver}
        >
          {dropZone === "val-menu-right-center" && <Test />}
        </div>
        <div
          className="w-full bg-red-400"
          onDrop={onDrop("val-menu-right-bottom")}
          onDragOver={onDragOver}
        >
          {dropZone === "val-menu-right-bottom" && <Test />}
        </div>
      </div>
    </div>
  );
}

const Test = () => <div className="" draggable="true"></div>;
