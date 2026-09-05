import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./cn";

const disabledBase =
  "disabled:text-fg-disabled disabled:pointer-events-none disabled:opacity-50 aria-disabled:text-fg-disabled aria-disabled:pointer-events-none aria-disabled:opacity-50";
const disabledVariant =
  "disabled:bg-bg-disabled disabled:text-fg-disabled disabled:border disabled:border-border-primary aria-disabled:bg-bg-disabled aria-disabled:text-fg-disabled aria-disabled:border aria-disabled:border-border-primary";

const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center whitespace-nowrap rounded-md text-fg-primary text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
    disabledBase,
  ),
  {
    variants: {
      variant: {
        default: cn(
          "cursor-pointer",
          "border border-border-brand-primary",
          "bg-bg-brand-primary text-fg-brand-primary",
          "hover:bg-bg-brand-primary-hover hover:text-fg-brand-primary-hover",
          disabledVariant,
        ),
        destructive: cn(
          "cursor-pointer",
          "border border-bg-error-primary",
          "bg-bg-error-primary text-fg-error-primary hover:bg-bg-error-primary-hover disabled:text-fg-error-primary aria-disabled:text-fg-error-primary",
        ),
        warning: cn(
          "cursor-pointer",
          "border border-bg-warning-secondary",
          "bg-bg-warning-secondary text-fg-warning-secondary hover:bg-bg-warning-secondary-hover disabled:text-fg-warning-secondary aria-disabled:text-fg-warning-secondary",
        ),
        outline: cn(
          "cursor-pointer",
          "border border-transparent",
          // `bg-transparent`, not `bg-bg-background`: there is no
          // `bg-background` key in the colour map, so that class compiled to
          // nothing and this variant has always been transparent.
          "bg-transparent hover:bg-bg-secondary",
          disabledVariant,
        ),
        secondary: cn(
          "cursor-pointer",
          "border border-border-secondary",
          "bg-bg-secondary text-fg-secondary hover:bg-bg-secondary-hover",
          disabledVariant,
        ),
        ghost: cn(
          "cursor-pointer",
          "border border-transparent",
          // See `outline`: `bg-bg-background` was never a real class.
          "bg-transparent hover:bg-bg-secondary",
          disabledVariant,
          "hover:bg-bg-secondary-hover hover:text-fg-secondary",
        ),
        link: cn(
          "cursor-pointer",
          "border border-transparent",
          "text-fg-primary underline-offset-4 hover:underline",
        ),
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        xs: "h-8 rounded-md px-2",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
        "icon-sm": "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/**
 * Focus ring for a control that fills its container edge to edge - a full-width
 * combobox trigger, most of the time.
 *
 * The default ring is a `box-shadow` spread, so it is painted 2px OUTSIDE the
 * border box. On a `w-full` control there is nothing outside the border box: the
 * halo lands on whatever encloses the field and gets clipped by the first
 * ancestor with `overflow-hidden`, which is how a focused combobox ended up
 * with an outline that looked like it belonged to something else. Inset, the
 * ring is painted inside the control and always shows in full.
 */
export const insetFocusRing = "focus-visible:ring-inset";

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
