import classNames from "classnames";
import { FC, SVGProps } from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  icon?: React.ReactElement<SVGProps<SVGSVGElement>>;
  active?: boolean;
  disabled?: boolean;
  tooltip?: string;
}
const Button: FC<ButtonProps> = ({
  variant = "primary",
  onClick,
  children,
  icon,
  active = false,
  disabled = false,
  tooltip
}) => {
  const cn = classNames(
    `font-mono font-[12px] tracking-[0.04em] font-[500] py-[8px] px-[12px] h-[40px] rounded whitespace-nowrap group relative`,
    active && "font-bold",
    variant === "primary"
      ? `bg-valYellow hover:bg-valLightGrey text-valWarmBlack disabled:bg-valWarmBlack disabled:text-valLightGrey`
      : `bg-transparent border border-valWhite text-valWhite hover:border-valYellow hover:text-valYellow disabled:bg-valWarmBlack disabled:text-valLightGrey`
  );
  return (
    <button disabled={disabled} className={cn} onClick={onClick}>
      {tooltip && (
        <div className={`absolute bottom-[-75%] left-0 z-20 bg-black w-fit h-fit text-valLightGrey hidden group-hover:block`}>
          <div>
            {tooltip}
          </div>
        </div>
      )}
      <span className="flex flex-row justify-center items-center gap-2">
        {icon && icon}
        {children}
      </span>
    </button>
  );
};

export default Button;
