import classNames from "classnames";
import { FC, SVGProps } from "react";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
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
  tooltip,
}) => {
  const cn = classNames(
    `font-mono font-[12px] tracking-[0.04em] font-[500] py-[8px] px-[12px] h-[40px] rounded whitespace-nowrap group relative`,
    {
      "font-bold": variant === "primary",
      "bg-base hover:bg-base text-fill disabled:bg-fill disabled:text-base":
        variant === "primary",
      "bg-transparent border border-primary text-primary hover:border-highlight hover:text-highlight disabled:bg-fill disabled:text-base":
        variant !== "primary",
    }
  );
  return (
    <button disabled={disabled} className={cn} onClick={onClick}>
      {tooltip && (
        <div
          className={`absolute bottom-[-75%] left-0 z-20 bg-black w-fit h-fit text-base hidden group-hover:block`}
        >
          <div>{tooltip}</div>
        </div>
      )}
      <span className="flex flex-row items-center justify-center gap-2">
        {icon && icon}
        {children}
      </span>
    </button>
  );
};

export default Button;
export function PrimaryButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="px-4 py-[2px] font-serif border rounded-sm border-border bg-fill text-primary hover:dark:bg-yellow hover:bg-warm-black hover:dark:text-dark-gray hover:text-white focus-visible:border-highlight focus:outline-none">
      {children}
    </button>
  );
}