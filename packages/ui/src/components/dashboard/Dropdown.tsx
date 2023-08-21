import classNames from "classnames";
import React, { Children, ReactElement, ReactNode, useState } from "react";
import Chevron from "../../assets/icons/Chevron";

type DropdownProps = {
  children?: ReactElement[] | ReactElement;
  childSelected?: (path: string) => void;
};
export function Dropdown({ children, childSelected }: DropdownProps): ReactElement {
  const [selected, setSelected] = useState<number>(0);
  const [open, setOpen] = useState(false);

  const handleClick = (path: string) => (idx: number) => {
    setSelected(idx);
    setOpen(false);
    if(childSelected) childSelected(path);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="font-serif group bg-warm-black text-white w-full hover:bg-dark-gray"
      >
        <span className="flex justify-between items-center ">
          {Children.toArray(children)[selected]}
          <Chevron
            className={classNames(
              "w-3 h-3 transform mr-3 hover:bg-warm-black",
              { " rotate-90 ": !open },
              { " rotate-0 ": open }
            )}
          />
        </span>
      </button>
      <div className={classNames({ hidden: !open }, { open: open })}>
        <div
          className={classNames(
            "absolute left-0 top-full w-full z-10 tracking-wider text-xs font-[400] "
          )}
        >
          {React.Children.map(children, (child, idx) => {
            return React.cloneElement(child as ReactElement, {
              selected: selected === idx,
              onClick: () => handleClick(idx),
            });
          })}
        </div>
      </div>
    </div>
  );
}

type DropdownChildProps = {
  children?: ReactNode | ReactNode[];
  onClick?: (child: ReactNode) => void;
  selected?: boolean;
};

Dropdown.Child = ({
  children,
  onClick,
  selected,
}: DropdownChildProps): ReactElement => {
  const handleClick = () => {
    onClick && onClick(children);
  };

  return (
    <button
      onClick={handleClick}
      className={classNames(
        "py-2 px-3 w-full flex flex-col bg-warm-black hover:bg-dark-gray tracking-wider text-xs font-[400]",
        { "bg-yellow text-warm-black ": selected },
        { "text-white ": !selected }
      )}
    >
      {children}
    </button>
  );
};
