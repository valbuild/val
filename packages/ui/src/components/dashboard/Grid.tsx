import { Children, useEffect, useRef } from "react";

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
        originalWidth.current + dx,
        150
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

  const [header1, body1, header2, body2, header3, body3] =
    Children.toArray(children);
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
        <Grid.Column>
          {header1}
          {body1}
        </Grid.Column>
        <div
          className="absolute inset-y-0 right-0 cursor-col-resize w-[1px] bg-dark-gray hover:w-[2px] hover:bg-light-gray"
          onMouseDown={handleMouseDown("left")}
        ></div>
      </div>
      <div className="bg-warm-black flex-auto">
        <Grid.Column>
          {header2}
          {body2}
        </Grid.Column>
      </div>
      <div
        ref={rightColRef}
        className="border-l border-dark-gray bg-warm-black relative"
        style={{ width: 300 }}
      >
        <Grid.Column>
          {header3}
          {body3}
        </Grid.Column>
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
};

Grid.Column = ({ children }: GridChildProps): React.ReactElement => {
  const [header, body] = Children.toArray(children);
  return (
    <div className="flex flex-col h-full bg-warm-black overflow-clip">
      <div className="h-[50px] flex items-center border-b border-dark-gray">
        {header}
      </div>
      {body}
    </div>
  );
};
