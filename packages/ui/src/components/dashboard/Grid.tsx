import {
  Children,
  cloneElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Dropdown from "../Dropdown";
import { Tree } from "./Tree";

type GridProps = {
  children: React.ReactNode | React.ReactNode[];
};

export function Grid({ children }: GridProps): React.ReactElement {
  const leftColRef = useRef<HTMLDivElement>(null);
  const rightColRef = useRef<HTMLDivElement>(null);

  const isResizing = useRef(false);
  const x = useRef(0);
  const dragRef = useRef<"left" | "right" | null>(null);
  const originalWidth = useRef(0);

  const handleMouseUp = () => {
    isResizing.current = false;
    dragRef.current = null;
    x.current = 0;
    originalWidth.current = 0;
  };

  const handleMouseMove = (event: MouseEvent) => {
    event.preventDefault();
    const targetRef = dragRef.current === "left" ? leftColRef : rightColRef;
    if (targetRef.current && isResizing.current) {
      const dx =
        dragRef.current === "left"
          ? event.screenX - x.current
          : x.current - event.screenX;
      targetRef.current.style.width = `${Math.max(
        originalWidth.current + dx
      )}px`;
    }
  };

  const handleMouseDown =
    (column: "left" | "right") =>
    (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      const target = event.target as HTMLDivElement;
      if (target) {
        const columnRef =
          column === "left"
            ? leftColRef
            : column === "right"
            ? rightColRef
            : null;
        isResizing.current = true;
        if (columnRef && columnRef.current) {
          x.current = event.screenX;
          dragRef.current = column;
          if (columnRef.current) {
            originalWidth.current = columnRef.current.offsetWidth;
          }
        }
      }
    };
  useEffect(() => {
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousemove", handleMouseMove);

    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  return (
    <div className="flex w-full h-screen">
      <div
        ref={leftColRef}
        className="border-r border-dark-gray relative h-full"
        style={{ width: 300 }}
      >
        <Tree>
          <Tree.Node path="Main nav" type="section" />
          <Tree.Node path="H1" type="text">
            <Tree.Node path="Section 3" type="text" />
            <Tree.Node path="Section 4" type="section">
              <Tree.Node path="Section 5" type="text" />
              <Tree.Node path="Section 6" type="section">
                <Tree.Node path="Section 7" type="text" />
              </Tree.Node>
            </Tree.Node>
          </Tree.Node>
        </Tree>
        <div
          className="absolute inset-y-0 right-0 cursor-col-resize w-[1px] bg-dark-gray hover:w-[2px] hover:bg-light-gray"
          onMouseDown={handleMouseDown("left")}
        ></div>
      </div>
      <div className="bg-warm-black flex-auto">
        <div className="flex flex-col all-but-last-child:border-b text-white all-but-last-child:border-dark-gray">
          test 2
        </div>
      </div>
      <div
        ref={rightColRef}
        className="border-l border-dark-gray bg-warm-black relative"
        style={{ width: 300 }}
      >
        <div className="text-white">hey</div>
        <div
          onMouseDown={handleMouseDown("right")}
          className="absolute inset-y-0 left-0 cursor-col-resize w-[1px]  bg-dark-gray hover:w-[2px] hover:bg-light-gray"
        ></div>
      </div>
    </div>
  );
}

type GridChildProps = {
  children: React.ReactNode | React.ReactNode[];
  header?: React.ReactNode | React.ReactNode[];
  width?: number;
  dragEnd?: (deltaWidth: number) => void;
};

Grid.Column = ({
  children,
  header,
  width,
  dragEnd,
}: GridChildProps): React.ReactElement => {
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);

  useEffect(() => {
    const handleMouseUp = (event: MouseEvent) => {
      setIsResizing(false);
      if (containerRef.current && isResizing) {
        const dx = event.screenX - x;
        if (dragEnd) {
          dragEnd(dx);
        }
      }
      setX(0);
    };

    const handleMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      if (isResizing && containerRef.current) {
        const newWidth = event.screenX - x;
        if (dragEnd) {
          dragEnd(newWidth);
        }
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousemove", handleMouseMove);
    };
  }, [isResizing]);

  const handleMouseDown: React.MouseEventHandler<HTMLDivElement> = (event) => {
    setIsResizing(true);
    setX(event.screenX);
  };

  return (
    <div
      className="flex flex-col bg-warm-black border border-dark-gray w-full h-screen relative"
      style={{ width: width }}
      ref={containerRef}
    >
      <div
        className="absolute inset-y-0 right-0 cursor-col-resize w-[1px]  bg-dark-gray hover:w-[2px] hover:bg-light-gray"
        onMouseDown={handleMouseDown}
      />
      <div className="border-b border-dark-gray flex items-center text-white min-h-[32px]">
        {header}
      </div>
      {children}
    </div>
  );
};
