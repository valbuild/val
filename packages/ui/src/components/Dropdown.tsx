import React, { SVGProps, useEffect, useRef, useState } from "react";
import Chevron from "../assets/icons/Chevron";
import Button from "./Button";
import { useValOverlayContext } from "./ValOverlayContext";

export interface DropdownProps {
  options: string[];
  label: string;
  onChange: (selectedOption: string) => void;
  icon?: React.ReactElement<SVGProps<SVGSVGElement>>;
  variant?: "primary" | "secondary";
}

const Dropdown: React.FC<DropdownProps> = ({
  options,
  onChange,
  label,
  icon,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [selectedOption, setSelectedOption] = useState<number>(0);
  const { windowSize } = useValOverlayContext();

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  const handleSelect = (option: string, idx: number) => {
    setSelectedOption(idx);
    onChange(option);
    setIsOpen(false);
  };

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        isOpen &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("click", handleOutsideClick);
    return () => {
      document.removeEventListener("click", handleOutsideClick);
    };
  }, []);

  return (
    <div className="val-text-[12px]" ref={dropdownRef}>
      <Button
        onClick={(ev) => {
          ev.preventDefault();
          handleToggle();
        }}
        icon={
          <Chevron
            className={`val-rotate-[-90deg] val-transition-transform val-duration-150 val-ease-in-out ${
              isOpen ? "" : "val-rotate-[90deg]"
            }`}
          />
        }
      >
        <div className="val-relative">
          <span className="val-flex val-flex-row val-items-center val-justify-center val-gap-1">
            {label}
            {icon && icon}
          </span>
          {isOpen && (
            <div
              className="val-absolute -val-top-[4px] val-overflow-scroll val-shadow-lg -val-left-2 val-text-primary val-bg-border val-w-fit val-z-overlay"
              style={{ maxHeight: windowSize?.innerHeight }}
            >
              <div className="val-flex val-flex-col ">
                {options?.map((option, idx) => (
                  <button
                    key={option}
                    onClick={(ev) => {
                      ev.preventDefault();
                      handleSelect(option, idx);
                    }}
                    className={`val-text-left val-px-2 val-py-1 hover:val-bg-base hover:val-text-highlight  ${
                      idx === selectedOption &&
                      "val-font-bold val-bg-base hover:val-bg-base val-truncate"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Button>
    </div>
  );
};

export default Dropdown;
