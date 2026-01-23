import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";

import { cn } from "./cn";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => {
  const [checked, setChecked] = React.useState<boolean | "indeterminate">();
  React.useEffect(() => {
    setChecked(props.checked);
  }, [props.checked]);
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      checked={checked}
      onCheckedChange={(ev) => {
        setChecked(ev);
        if (props.onCheckedChange) {
          props.onCheckedChange(ev);
        }
      }}
      className={cn(
        "peer h-4 w-4 shrink-0 rounded-sm bg-bg-primary border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 data-[state=checked]:bg-bg-primary data-[state=checked]:text-fg-primary",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className={cn("flex items-center justify-center text-current")}
      >
        {checked === true && <Check size={12} />}
        {checked === "indeterminate" && <Minus size={12} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
