import classNames from "classnames";
import { FC, SVGProps } from "react";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  icon?: React.ReactElement<SVGProps<SVGSVGElement>>;
  active?: boolean;
  disabled?: boolean;
}

/**
 *
 * @deprecated Use ui/Button
 */
export function PrimaryButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-[2px] font-serif border rounded-sm border-border text-primary hover:dark:bg-yellow hover:bg-warm-black hover:dark:text-dark-gray hover:text-white focus-visible:border-highlight focus:outline-none"
    >
      {children}
    </button>
  );
}

const Button: FC<ButtonProps> = ({
  variant = "primary",
  onClick,
  children,
  icon,
  // active = false,
  disabled = false,
}) => {
  return (
    <button
      disabled={disabled}
      className={classNames(
        "font-sans font-[12px] tracking-[0.04em] py-1 px-2 rounded whitespace-nowrap group relative text-primary",
        {
          "font-bold": variant === "primary",
          "text-fill disabled:bg-fill disabled:text-background":
            variant === "primary",
          "border border-primary text-primary hover:border-highlight hover:text-highlight disabled:bg-fill disabled:text-background":
            variant !== "primary",
        }
      )}
      onClick={onClick}
    >
      <span className="flex flex-row items-center justify-center gap-2">
        {icon && icon}
        {children}
      </span>
    </button>
  );
};

/**
 *
 * @deprecated Use ui/Button
 */
export default Button;
