import React, { useEffect, useRef, useState } from "react";
import { AlignJustify, X } from "react-feather";
import classNames from "classnames";
import { Resizable } from "react-resizable";
import { useValOverlayContext } from "./ValOverlayContext";

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
  const { windowSize, setWindowSize } = useValOverlayContext();
  useEffect(() => {
    if (!windowSize) {
      setWindowSize({
        height: MIN_HEIGHT,
        width: MIN_WIDTH,
        innerHeight:
          MIN_HEIGHT -
          (64 + (bottomRef.current?.getBoundingClientRect()?.height || 0)),
      });
    }
  }, [windowSize]);
  //
  const bottomRef = useRef<HTMLDivElement>(null);

  return (
    <Resizable
      width={windowSize?.width || MIN_WIDTH}
      height={windowSize?.height || MIN_HEIGHT}
      onResize={(_, { size }) =>
        setWindowSize({
          ...size,
          innerHeight:
            (windowSize?.height || MIN_HEIGHT) -
            (64 + (bottomRef.current?.getBoundingClientRect()?.height || 0)),
        })
      }
      handle={
        <div className="val-fixed val-bottom-0 val-right-0 val-cursor-se-resize">
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
        "val-absolute val-inset-0 tablet:val-w-auto tablet:val-h-auto tablet:val-min-h-fit tablet:val-rounded val-bg-base val-text-primary val-drop-shadow-2xl val-min-w-[320px] val-transition-opacity val-duration-300 val-delay-75",
        {
          "val-opacity-0": !isInitialized,
          "val-opacity-100": isInitialized,
        }
      )}
    >
      <div
        style={{
          width: windowSize?.width || MIN_WIDTH,
          height: windowSize?.height || MIN_HEIGHT,
          left: draggedPosition.left,
          top: draggedPosition.top,
        }}
      >
        <div
          ref={dragRef}
          className="val-relative val-flex val-items-center val-justify-center val-px-2 val-pt-2 val-text-primary"
        >
          <AlignJustify
            size={16}
            className="val-hidden val-w-full val-cursor-grab tablet:val-block"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMouseDownDrag();
            }}
          />
          <button
            className="val-absolute val-top-0 val-right-0 val-px-4 val-py-2 focus:val-outline-none focus-visible:val-outline-highlight"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <form
          className="val-h-full"
          onSubmit={(ev) => {
            ev.preventDefault();
          }}
        >
          {Array.isArray(children) && children.slice(0, 1)}
          <div
            className="val-relative val-overflow-scroll"
            style={{
              height: windowSize?.innerHeight,
            }}
          >
            {Array.isArray(children) ? children.slice(1, -1) : children}
          </div>
          <div ref={bottomRef} className="val-w-full val-px-4 val-pb-0">
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
