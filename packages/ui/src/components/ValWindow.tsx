import React, { useEffect, useRef, useState } from "react";
import { AlignJustify, X } from "react-feather";

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
  const [draggedPosition, ref, onMouseDown] = useDrag({ position });
  return (
    <div
      className="absolute rounded bg-base drop-shadow-2xl min-w-[320px]"
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
          onMouseDown={onMouseDown}
        />
        <button
          className="absolute right-0 px-4 -translate-y-1/2 top-1/2"
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
  return [position, ref, handleMouseDown] as const;
}
