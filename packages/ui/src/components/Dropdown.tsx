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
    <div className="text-[12px]" ref={dropdownRef}>
      <Button
        onClick={(ev) => {
          ev.preventDefault();
          handleToggle();
        }}
        icon={
          <Chevron
            className={`rotate-[-90deg] transition-transform duration-150 ease-in-out ${
              isOpen ? "" : "rotate-[90deg]"
            }`}
          />
        }
      >
        <div className="relative">
          <span className="flex flex-row items-center justify-center gap-1">
            {label}
            {icon && icon}
          </span>
          {isOpen && (
            <div
              className="absolute -top-[4px] overflow-scroll shadow-lg -left-2 text-primary w-fit z-overlay"
              style={{ maxHeight: windowSize?.innerHeight }}
            >
              <div className="flex flex-col ">
                {options?.map((option, idx) => (
                  <button
                    key={option}
                    onClick={(ev) => {
                      ev.preventDefault();
                      handleSelect(option, idx);
                    }}
                    className={`text-left px-2 py-1 hover:text-highlight  ${
                      idx === selectedOption && "font-bold truncate"
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
