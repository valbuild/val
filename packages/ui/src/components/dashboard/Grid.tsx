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
    <div className="val-flex val-w-full val-h-screen">
      <div
        ref={leftColRef}
        className="val-relative val-h-full val-border-r val-border-dark-gray"
        style={{ width: 300 }}
      >
        <Grid.Column>
          {header1}
          {body1}
        </Grid.Column>
        <div
          className="val-absolute val-inset-y-0 val-right-0 val-cursor-col-resize val-w-[1px] val-bg-dark-gray hover:val-w-[2px] hover:val-bg-light-gray"
          onMouseDown={handleMouseDown("left")}
        ></div>
      </div>
      <div className="val-flex-auto val-bg-warm-black">
        <Grid.Column>
          {header2}
          {body2}
        </Grid.Column>
      </div>
      {header3 ||
        (body3 && (
          <div
            ref={rightColRef}
            className="val-relative val-border-l val-border-dark-gray val-bg-warm-black"
            style={{ width: 300 }}
          >
            <Grid.Column>
              {header3}
              {body3}
            </Grid.Column>
            <div
              onMouseDown={handleMouseDown("right")}
              className="val-absolute val-inset-y-0 val-left-0 val-cursor-col-resize val-w-[1px] val-bg-dark-gray hover:val-w-[2px] hover:val-bg-light-gray"
            ></div>
          </div>
        ))}
    </div>
  );
}

type GridChildProps = {
  children: React.ReactNode | React.ReactNode[];
};

Grid.Column = ({ children }: GridChildProps): React.ReactElement => {
  const [header, body] = Children.toArray(children);
  return (
    <div className="val-flex val-flex-col val-h-full val-overflow-auto val-bg-warm-black">
      <div className="val-h-[50px] val-flex val-items-center val-border-b val-border-dark-gray">
        {header}
      </div>
      {body}
    </div>
  );
};
