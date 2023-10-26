import classNames from "classnames";
import { FC } from "react";

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
      <label className="val-flex val-items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => handleChange(event.target.checked)}
          className="hidden"
        />
        <span
          className={classNames(
            "val-w-[14px] val-h-[14px] val-border val-rounded val-border-gray-400 val-flex val-items-center val-justify-center",
            {
              "val-bg-highlight": checked,
              "val-bg-fill": !checked,
            }
          )}
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
        <span className="val-ml-2 val-font-mono val-text-primary">{label}</span>
      </label>
    </div>
  );
};

export default Checkbox;
