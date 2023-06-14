import React, { SVGProps, useEffect, useRef, useState } from "react";
import Chevron from "../assets/icons/Chevron";
import Button from "./Button";

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
  variant = "primary",
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [selectedOption, setSelectedOption] = useState<number>(0);

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
    <div ref={dropdownRef}>
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
        <span className="flex flex-row items-center justify-center gap-1">
          {label}
          {icon && icon}
        </span>
      </Button>
      {isOpen && (
        <div className="absolute left-0 mt-2 w-48 border shadow-lg font-mono font-[500] tracking-[0.04em] text-[14px] border-base text-primary bg-border z-10">
          <div className="py-1 rounded-md">
            {options?.map((option, idx) => (
              <button
                key={option}
                onClick={(ev) => {
                  ev.preventDefault();
                  handleSelect(option, idx);
                }}
                className={`w-full text-left px-4 py-2 hover:bg-base hover:text-highlight  ${
                  idx === selectedOption && "font-bold bg-base hover:bg-base"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dropdown;
