import classNames from "classnames";
import { FC, SVGProps } from "react";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  icon?: React.ReactElement<SVGProps<SVGSVGElement>>;
  active?: boolean;
  disabled?: boolean;
}

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
      className="val-px-4 val-py-[2px] val-font-serif val-border val-rounded-sm val-border-border val-bg-fill val-text-primary hover:dark:bg-yellow hover:val-bg-warm-black hover:dark:val-text-dark-gray hover:val-text-white focus-visible:val-border-highlight focus:val-outline-none"
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
        "val-font-sans val-font-[12px] val-tracking-[0.04em] val-py-1 val-px-2 val-rounded val-whitespace-nowrap val-group val-relative val-text-primary",
        {
          "val-font-bold": variant === "primary",
          "val-bg-base hover:val-bg-base disabled:val-bg-fill disabled:val-text-base":
            variant === "primary",
          "val-bg-transparent val-border val-border-primary val-text-primary hover:val-border-highlight hover:val-text-highlight disabled:val-bg-fill disabled:val-text-base":
            variant !== "primary",
        }
      )}
      onClick={onClick}
    >
      <span className="val-flex val-flex-row val-items-center val-justify-center val-gap-2">
        {icon && icon}
        {children}
      </span>
    </button>
  );
};

export default Button;
