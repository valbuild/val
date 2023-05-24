import React, { useEffect, useRef, useState } from "react";
import { AlignJustify, X } from "react-feather";
import classNames from "classnames";

export type ValWindowProps = {
  children: React.ReactNode;
  onClose: () => void;
  position?: { left: number; top: number };
};

export function ValWindow({
  position,
  onClose,
  children,
}: ValWindowProps): React.ReactElement {
  const [draggedPosition, isInitialized, ref, onMouseDown] = useDrag({
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
  return (
    <div
      className={classNames(
        "absolute rounded bg-base drop-shadow-2xl min-w-[320px] transition-opacity duration-300",
        {
          "opacity-0": isInitialized,
          "opacity-100": !isInitialized,
        }
      )}
      style={{
        left: draggedPosition.left,
        top: draggedPosition.top,
      }}
    >
      <div
        ref={ref}
        className="relative flex justify-center px-2 py-2 text-primary"
      >
        <AlignJustify
          size={16}
          className="w-full cursor-grab"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onMouseDown();
          }}
        />
        <button
          className="absolute right-0 px-4 -translate-y-1/2 top-1/2 focus:outline-none focus-visible:outline-highlight"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      {children}
    </div>
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
      setPosition({
        left:
          initPosition.left -
          (ref?.current?.getBoundingClientRect()?.width || 0) / 2,
        top: initPosition.top - 16,
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
        const top =
          -((ref?.current?.getBoundingClientRect()?.height || 0) / 2) +
          +e.clientY;

        setPosition({
          left:
            -((ref?.current?.getBoundingClientRect()?.width || 0) / 2) +
            e.clientX,
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

  const handleMouseDown = () => setMouseDown(true);
  const isInitialized = !ref?.current?.getBoundingClientRect()?.width;
  return [position, isInitialized, ref, handleMouseDown] as const;
}
