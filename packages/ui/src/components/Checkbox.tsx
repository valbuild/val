import { FC, useState } from "react";

export interface CheckboxProps {
  label: string;
  checked: boolean;
  setChecked: React.Dispatch<React.SetStateAction<boolean>>;
}

const Checkbox: FC<CheckboxProps> = ({ label, checked, setChecked }) => {
  const handleChange = (checked: boolean) => {
    setChecked(checked);
  };

  return (
    <div>
      <label className="flex items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => handleChange(event.target.checked)}
          className="hidden"
        />{" "}
        <span
          className={`w-[14px] h-[14px] border rounded border-gray-400 flex items-center justify-center ${
            checked ? "bg-valYellow" : "bg-valWarmBlack"
          }`}
        >
          {checked && (
            <svg
              width="10"
              height="7"
              viewBox="0 0 10 7"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M1 1L5 6L9 1" stroke="#1A1A1A" stroke-linecap="square" />
            </svg>
          )}
        </span>
        <span className="ml-2 text-valWhite font-mono">{label}</span>
      </label>
    </div>
  );
};

export default Checkbox;
