import React, { useEffect, useRef, useState } from "react";
import classNames from "classnames";
import { Resizable } from "react-resizable";
import { useValUIContext } from "./ValUIContext";
import { AlignJustifyIcon, XIcon } from "lucide-react";
import { ScrollArea } from "./ui/scroll-area";

export type ValWindowProps = {
  children:
    | [React.ReactNode, React.ReactNode, React.ReactNode]
    | React.ReactNode;

  onClose: () => void;
  position?: Position;
  isInitialized?: true;
};

const MIN_WIDTH = 400;
const MIN_HEIGHT = 250;

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
  const { windowSize, setWindowSize } = useValUIContext();
  useEffect(() => {
    setWindowSize({
      height: window.innerHeight - 30,
      width: MIN_WIDTH,
      innerHeight:
        window.innerHeight -
        30 -
        (64 + (bottomRef.current?.getBoundingClientRect()?.height || 0)),
    });
  }, []);
  //
  const bottomRef = useRef<HTMLDivElement>(null);

  return (
    <Resizable
      minConstraints={[MIN_WIDTH, MIN_HEIGHT]}
      width={windowSize?.width || MIN_WIDTH}
      height={windowSize?.height || MIN_HEIGHT}
      onResize={(_, { size }) =>
        setWindowSize({
          ...size,
          innerHeight:
            size.height -
            (64 + (bottomRef.current?.getBoundingClientRect()?.height || 0)),
        })
      }
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
        "absolute inset-0 tablet:w-auto tablet:h-auto tablet:min-h-fit rounded-lg bg-gradient-to-br from-background/90 from-40% to-background backdrop-blur-lg text-primary drop-shadow-2xl min-w-[320px]",
        {
          "opacity-0": !isInitialized,
          "opacity-100": isInitialized,
        }
      )}
    >
      <div
        style={{
          width: windowSize?.width || MIN_WIDTH,
          height: windowSize?.height || MIN_HEIGHT,
          left: draggedPosition.left,
          top: draggedPosition.top,
          right: draggedPosition.right,
          bottom: draggedPosition.bottom,
        }}
      >
        <div
          ref={dragRef}
          className="relative flex items-center justify-center px-2 py-2 text-primary"
        >
          <AlignJustifyIcon
            size={16}
            className="w-full cursor-grab tablet:block"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMouseDownDrag();
            }}
          />
          <button
            className="absolute top-0 right-0 px-4 py-2 focus:outline-none focus-visible:outline-accent"
            onClick={onClose}
          >
            <XIcon size={16} />
          </button>
        </div>
        <div>
          {Array.isArray(children) && children.slice(0, 1)}
          <ScrollArea
            className="relative"
            style={{
              height: windowSize?.innerHeight,
            }}
          >
            {Array.isArray(children) ? children.slice(1, -1) : children}
          </ScrollArea>
          <div ref={bottomRef} className="w-full px-4 pb-0">
            {Array.isArray(children) && children.slice(-1)}
          </div>
        </div>
      </div>
    </Resizable>
  );
}

export type Position = (
  | { left: number; right?: undefined }
  | { right: number; left?: undefined }
) &
  ({ top: number; bottom?: undefined } | { bottom: number; top?: undefined });

function useDrag({ position: initPosition }: { position?: Position }) {
  const [position, setPosition] = useState<
    (
      | { left: number; right?: undefined }
      | { right: number; left?: undefined }
    ) &
      (
        | { top: number; bottom?: undefined }
        | { bottom: number; top?: undefined }
      )
  >({ left: window.innerWidth - MIN_WIDTH - (24 + 50), top: 16 });
  useEffect(() => {
    if (initPosition) {
      setPosition(initPosition);
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
          -((ref?.current?.getBoundingClientRect()?.width || 0) / 2) +
          e.clientX;
        const top =
          -((ref?.current?.getBoundingClientRect()?.height || 0) / 2) +
          +e.clientY;
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
