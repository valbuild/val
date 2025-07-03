import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-fg-primary text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:text-fg-disabled disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: cn(
          "cursor-pointer",
          "border border-border-brand-primary",
          "bg-bg-brand-primary text-fg-brand-primary",
          "hover:bg-bg-brand-primary-hover hover:text-fg-brand-primary-hover",
          "disabled:bg-bg-disabled disabled:text-fg-disabled disabled:border disabled:border-border-primary",
        ),
        destructive: cn(
          "cursor-pointer",
          "border border-bg-error-primary",
          "bg-bg-error-primary text-fg-error-primary hover:bg-bg-error-primary-hover disabled:text-fg-error-primary",
        ),
        outline: cn(
          "cursor-pointer",
          "border border-transparent",
          "bg-bg-background hover:bg-bg-secondary",
          "disabled:bg-bg-disabled disabled:text-fg-disabled disabled:border disabled:border-border-primary",
        ),
        secondary: cn(
          "cursor-pointer",
          "border border-border-secondary",
          "bg-bg-secondary text-fg-secondary hover:bg-bg-secondary-hover",
        ),
        ghost: cn(
          "cursor-pointer",
          "border border-transparent",
          "bg-bg-background hover:bg-bg-secondary",
          "disabled:bg-bg-disabled disabled:text-fg-disabled disabled:border disabled:border-border-primary",
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
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
