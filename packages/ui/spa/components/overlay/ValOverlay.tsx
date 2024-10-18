import classNames from "classnames";
import {
  Edit,
  Eye,
  EyeOff,
  PanelsTopLeft,
  Search,
  SquareMousePointer,
  Upload,
  X,
} from "lucide-react";
import { useState } from "react";
import { AnimateHeight } from "../../ng/components/AnimateHeight";

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

export function ValOverlay(props: ValOverlayProps) {
  return <DraggableValMenu {...props} />;
}

function ValMenu({
  dropZone,
  ghost,
  draftMode,
  setDraftMode,
  disableOverlay,
}: {
  dropZone: DropZones;
  ghost?: boolean;
} & ValOverlayProps) {
  const dir =
    dropZone === "val-menu-right-center" || dropZone === "val-menu-left-center"
      ? "vertical"
      : "horizontal";
  return (
    <div className="p-4">
      <AnimateHeight isOpen={draftMode}>
        <div
          className={classNames(
            "flex relative rounded bg-bg-primary text-text-primary gap-2",
            {
              "flex-col py-4 px-2": dir === "vertical",
              "flex-row px-4 py-2": dir === "horizontal",
              "opacity-70": ghost,
            },
          )}
        >
          <MenuButton
            label="Pick content"
            icon={
              <SquareMousePointer
                size={16}
                onMouseEnter={() => console.log("mouse enter")}
                onMouseLeave={() => console.log("mouse leave")}
              />
            }
          />
          <MenuButton label="Search" icon={<Search size={16} />} />
          <MenuButton
            label="Disable draft mode"
            icon={<EyeOff size={16} />}
            onClick={() => setDraftMode(false)}
          />
          <div className="pb-1 mt-1 border-t border-border-primary"></div>
          <MenuButton label="Publish" icon={<Upload size={16} />} />
          <MenuButton label="Studio" icon={<PanelsTopLeft size={16} />} />
        </div>
      </AnimateHeight>
      <AnimateHeight isOpen={!draftMode}>
        <div
          className={classNames(
            "flex relative rounded bg-bg-primary text-text-primary gap-2",
            {
              "flex-col py-4 px-2": dir === "vertical",
              "flex-row px-4 py-2": dir === "horizontal",
              "opacity-70": ghost,
            },
          )}
        >
          <MenuButton
            label="Enable draft mode"
            icon={<Edit size={16} />}
            onClick={() => setDraftMode(true)}
          />
          <MenuButton
            label="Disable Val"
            icon={<X size={16} />}
            onClick={() => disableOverlay()}
          />
        </div>
      </AnimateHeight>
    </div>
  );
}

function MenuButton({
  icon,
  onClick,
  label,
}: {
  icon: React.ReactNode;
  onClick?: () => void;
  label?: string;
}) {
  return (
    <button className="p-2" onClick={onClick} aria-label={label} title={label}>
      {icon}
    </button>
  );
}

function DraggableValMenu(props: ValOverlayProps) {
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
        <ValMenu dropZone={dropZone} {...props} />
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
              <ValMenu dropZone={dragOverDropZone} ghost {...props} />
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
