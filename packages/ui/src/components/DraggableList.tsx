import classNames from "classnames";
import { createRef, useEffect, useState } from "react";

export type DraggableResult = {
  from: number;
  to: number;
};

export type DraggableListProps = {
  children: React.ReactNode | React.ReactNode[];
  onDragEnd?: (result: DraggableResult) => void;
};

export const DraggableList = ({
  children: rawChildren,
}: DraggableListProps): React.ReactElement => {
  const [from, setFrom] = useState<number | undefined>();
  const [fromHeight, setFromHeight] = useState<number | undefined>();
  const [dragOver, setDragOver] = useState<number | undefined>();
  const [children, setChildren] = useState<React.ReactNode[]>([]);
  const [dropHappened, setDropHappened] = useState<boolean>(false);
  useEffect(() => {
    setChildren(Array.isArray(rawChildren) ? rawChildren : [rawChildren]);
  }, [rawChildren]);

  return (
    <>
      {[...children, <div className="h-[10px]"></div>].map((child, idx) => {
        const ref = createRef<HTMLDivElement>();
        return (
          <div key={idx} className="relative">
            {dragOver === idx && (
              <div className="flex items-center">
                <div className="border-[2px] border-yellow w-3 h-3 rounded-full" />
                <div className="bg-yborder-yellow w-full h-[1px]" />
                <div className="border-[2px] border-yellow w-3 h-3 rounded-full" />
              </div>
            )}
            <div
              ref={ref}
              draggable
              className={classNames("cursor-grab transition-opacity")}
              onDragStart={(ev) => {
                ev.dataTransfer.setDragImage(new Image(), 0, 0);
                setFrom(idx);
                setFromHeight(ref.current?.offsetHeight);
              }}
              onDragOver={(ev) => {
                ev.preventDefault();
                setDragOver(idx);
              }}
              onDragEnd={(ev) => {
                ev.preventDefault();
                if (
                  from !== undefined &&
                  !dropHappened &&
                  dragOver !== undefined
                ) {
                  const copy = [...children];
                  copy.splice(from, 1);
                  copy.splice(
                    Math.min(dragOver, children.length - 1),
                    0,
                    children[from]
                  );
                  setChildren(copy);
                }
                setDropHappened(false);
                setFrom(undefined);
                setDragOver(undefined);
              }}
              onDrop={(ev) => {
                ev.preventDefault();
                if (from !== undefined) {
                  const copy = [...children];
                  copy.splice(from, 1);
                  copy.splice(
                    Math.min(idx, children.length - 1),
                    0,
                    children[from]
                  );
                  setChildren(copy);
                  setDragOver(undefined);
                  setFrom(undefined);
                  setDropHappened(true);
                }
              }}
            >
              {child}
            </div>
          </div>
        );
      })}
    </>
  );
};
