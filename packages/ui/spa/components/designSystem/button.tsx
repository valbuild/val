import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-fg-primary text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:text-text-disabled disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-bg-brand-primary text-fg-primary hover:bg-bg-secondary_hover/90 disabled:bg-bg-primary disabled:text-text-disabled disabled:border disabled:border-border-primary",
        destructive:
          "bg-bg-error text-text-error-pimary hover:bg-bg-error_hover/90",
        outline:
          "border border-input bg-bg-background hover:bg-bg-brand-solid_hover hover:text-secondary_hover",
        secondary:
          "bg-bg-secondary text-fg-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-bg-secondary_hover hover:text-fg-secondary",
        link: "text-fg-primary underline-offset-4 hover:underline",
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
