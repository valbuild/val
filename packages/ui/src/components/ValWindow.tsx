import React, { useEffect, useRef, useState } from "react";
import { AlignJustify, X } from "react-feather";
import classNames from "classnames";
import { Resizable } from "react-resizable";

export type ValWindowProps = {
  children:
    | [React.ReactNode, React.ReactNode, React.ReactNode]
    | React.ReactNode;

  onClose: () => void;
  position?: { left: number; top: number };
  isInitialized?: true;
};

const MIN_WIDTH = 320;
const MIN_HEIGHT = 320;

export function ValWindow({
  position,
  onClose,
  children,
}: ValWindowProps): React.ReactElement {
  const [draggedPosition, isInitialized, dragRef, onMouseDownDrag] = useDrag({
    position,
  });
  useEffect(() => {
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keyup", closeOnEscape);
    return () => {
      document.removeEventListener("keyup", closeOnEscape);
    };
  }, []);

  //
  const [size, setSize] = useState<{ height: number; width: number }>();
  //
  const bottomRef = useRef<HTMLDivElement>(null);

  return (
    <Resizable
      width={size?.width || MIN_WIDTH}
      height={size?.height || MIN_HEIGHT}
      onResize={(_, { size }) => setSize(size)}
      handle={
        <div className="fixed bottom-0 right-0 cursor-se-resize">
          <svg
            height="18"
            viewBox="0 0 18 18"
            width="18"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="m14.228 16.227a1 1 0 0 1 -.707-1.707l1-1a1 1 0 0 1 1.416 1.414l-1 1a1 1 0 0 1 -.707.293zm-5.638 0a1 1 0 0 1 -.707-1.707l6.638-6.638a1 1 0 0 1 1.416 1.414l-6.638 6.638a1 1 0 0 1 -.707.293zm-5.84 0a1 1 0 0 1 -.707-1.707l12.477-12.477a1 1 0 1 1 1.415 1.414l-12.478 12.477a1 1 0 0 1 -.707.293z"
              fill="currentColor"
            />
          </svg>
        </div>
      }
      draggableOpts={{}}
      className={classNames(
        "absolute inset-0  tablet:w-auto tablet:h-auto tablet:min-h-fit tablet:rounded bg-base text-primary drop-shadow-2xl min-w-[320px] transition-opacity duration-300 delay-75",
        {
          "opacity-0": !isInitialized,
          "opacity-100": isInitialized,
        }
      )}
    >
      <div
        style={{
          width: size?.width || MIN_WIDTH,
          height: size?.height || MIN_HEIGHT,
          left: draggedPosition.left,
          top: draggedPosition.top,
        }}
      >
        <div
          ref={dragRef}
          className="relative flex items-center justify-center px-2 pt-2 text-primary"
        >
          <AlignJustify
            size={16}
            className="hidden w-full cursor-grab tablet:block"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMouseDownDrag();
            }}
          />
          <button
            className="absolute top-0 right-0 px-4 py-2 focus:outline-none focus-visible:outline-highlight"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <form
          className="h-full"
          onSubmit={(ev) => {
            ev.preventDefault();
          }}
        >
          {Array.isArray(children) && children.slice(0, 1)}
          <div
            className="relative overflow-scroll"
            style={{
              height:
                (size?.height || MIN_HEIGHT) -
                (64 +
                  (bottomRef.current?.getBoundingClientRect()?.height || 0)),
            }}
          >
            {Array.isArray(children) ? children.slice(1, -1) : children}
          </div>
          <div ref={bottomRef} className="w-full px-4 pb-0">
            {Array.isArray(children) && children.slice(-1)}
          </div>
        </form>
      </div>
    </Resizable>
  );
}

function useDrag({
  position: initPosition,
}: {
  position?: { left: number; top: number };
}) {
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (initPosition) {
      const left =
        initPosition.left -
        (ref?.current?.getBoundingClientRect()?.width || 0) / 2;
      const top = initPosition.top - 16;
      setPosition({
        left: left < 0 ? 0 : left,
        top: top < 0 ? 0 : top,
      });
    } else {
      const left = window.innerWidth / 2 - MIN_WIDTH / 2 - window.scrollX;
      const top = window.innerHeight / 2 - MIN_HEIGHT / 2 + window.scrollY;
      setPosition({
        left,
        top,
      });
    }
  }, [initPosition]);

  const [mouseDown, setMouseDown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onMouseUp = () => {
      setMouseDown(false);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (mouseDown) {
        e.preventDefault();
        e.stopPropagation();
        const left =
          -((ref?.current?.getBoundingClientRect()?.width || 0) / 2) + e.pageX;
        const top =
          -((ref?.current?.getBoundingClientRect()?.height || 0) / 2) +
          +e.pageY;
        setPosition({
          left: left < 0 ? 0 : left,
          top: top < 0 ? 0 : top,
        });
      }
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousemove", onMouseMove);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousemove", onMouseMove);
    };
  }, [mouseDown]);

  // TODO: rename hook from useDrag to usePosition or something since we also check for screen width here?
  useEffect(() => {
    const onResize = () => {
      if (window.screen.width < MIN_WIDTH * 2) {
        setPosition({
          left: 0,
          top: 0,
        });
      }
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);
  const handleMouseDown = () => setMouseDown(true);
  const isInitialized = !!ref?.current?.getBoundingClientRect()?.width;
  return [position, isInitialized, ref, handleMouseDown] as const;
}
