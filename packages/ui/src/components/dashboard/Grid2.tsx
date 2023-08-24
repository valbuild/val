import classNames from "classnames";
import { Children, cloneElement, useRef } from "react";

interface GridProps {
  children: React.ReactNode | React.ReactNode[];
}
export function Grid({ children }: GridProps): React.ReactElement {
  const leftColHeaderRef = useRef<HTMLDivElement>(null);
  const leftColBodyRef = useRef<HTMLDivElement>(null);
  const rightColHeaderRef = useRef<HTMLDivElement>(null);
  const rightColBodyRef = useRef<HTMLDivElement>(null);

  const [headerRow, bodyRow] = Children.toArray(children);

  return (
    <div className="flex flex-col w-full h-screen bg-warm-black">
      {cloneElement(headerRow as React.ReactElement, {
        leftColRef: leftColHeaderRef,
        rightColRef: rightColHeaderRef,
      })}
      {cloneElement(bodyRow as React.ReactElement, {
        leftColRef: leftColBodyRef,
        rightColRef: rightColBodyRef,
      })}
    </div>
  );
}

type GridRowProps = {
  children: React.ReactNode | React.ReactNode[];
  leftColRef?: React.RefObject<HTMLDivElement>;
  rightColRef?: React.RefObject<HTMLDivElement>;
  fill?: boolean;
};

Grid.Row = ({
  children,
  leftColRef,
  rightColRef,
  fill = false,
}: GridRowProps): React.ReactElement => {
  const [leftCol, middleCol, rightCol] = Children.toArray(children);
  //implement mouseover event to share hover-event between rows
  console;
  return (
    <div
      className={classNames("flex w-full py-2 border-b border-dark-gray", {
        "h-full": fill,
      })}
    >
      <div className="relative" style={{ width: "300px" }} ref={leftColRef}>
        {leftCol}
        <div
          className="absolute inset-y-0 right-0 cursor-col-resize w-[1px] bg-dark-gray hover:w-[2px] hover:bg-light-gray -my-2"
          //   onMouseDown={handleMouseDown("left")}
        ></div>
      </div>
      <div className="flex-auto">{middleCol}</div>
      <div className="relative" style={{ width: "300px" }} ref={rightColRef}>
        {rightCol}
        <div
          //   onMouseDown={handleMouseDown("right")}
          className="absolute inset-y-0 left-0 cursor-col-resize w-[1px]  bg-dark-gray hover:w-[2px] hover:bg-light-gray -my-2"
        ></div>
      </div>
    </div>
  );
};
