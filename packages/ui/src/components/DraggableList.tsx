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
  useEffect(() => {
    setChildren(Array.isArray(rawChildren) ? rawChildren : [rawChildren]);
  }, [rawChildren]);

  return (
    <>
      {children.map((child, idx) => {
        const ref = createRef<HTMLDivElement>();
        return (
          <div key={idx}>
            <div
              ref={ref}
              draggable
              className={classNames("cursor-grab transition-opacity", {
                // hidden: from === idx,
                // "border border-red": dragOver === idx,
                "opacity-0": from === idx,
              })}
              style={{
                translate:
                  dragOver !== undefined && dragOver < idx
                    ? `0 ${fromHeight}px`
                    : "0 0",
              }}
              onDragStart={(ev) => {
                const img = new Image();
                // img.src =
                //   'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" height="0" width="0" />';
                ev.dataTransfer.setDragImage(img, 0, 0);
                setFrom(idx);
                setFromHeight(ref.current?.offsetHeight);
              }}
              onDragOver={(ev) => {
                ev.preventDefault();
                setDragOver(idx);
              }}
              onDragEnd={(ev) => {
                ev.preventDefault();

                console.log("drag end", from, dragOver);
                // if (from !== undefined && dragOver !== undefined) {
                //   const copy = [...children];
                //   copy.splice(from, 1);
                //   copy.splice(dragOver, 0, children[from]);
                //   setChildren(copy);
                //   console.log("drag end copy");
                // }
                setFrom(undefined);
                setDragOver(undefined);
              }}
              onDrop={(ev) => {
                ev.preventDefault();
                console.log("drop", from, idx);
                if (from !== undefined) {
                  const copy = [...children];
                  copy.splice(from, 1);
                  copy.splice(idx, 0, children[from]);
                  setChildren(copy);
                  setDragOver(undefined);
                  setFrom(undefined);
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
