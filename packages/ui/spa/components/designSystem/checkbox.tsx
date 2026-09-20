import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";

import { cn } from "./cn";

/**
 * A checkbox.
 *
 * Two things here were wrong, and both are the kind that survive review because
 * they look fine on the surface they were designed on.
 *
 * **The border named a dead token.** `border-primary-foreground` resolves to
 * `hsl(var(--primary-foreground))`, and that variable lives in the shadcn
 * compatibility block declared under `:root` and `.dark` - neither of which a
 * shadow root matches, and `darkMode` is `[data-mode="dark"]` so `.dark` never
 * matches anywhere. This is the defect `focusRingTokens.test.ts` documents, in
 * a property that fails more quietly than `box-shadow` did:
 *
 *  - in the Studio (index.css linked INTO the shadow root, nothing declaring
 *    the token above it) the declaration is invalid at computed-value time, so
 *    `border-color` falls back to `currentColor` - the box is outlined in
 *    whatever colour the text beside it happens to be, and goes faint on a
 *    muted row;
 *  - in Storybook, which links index.css into the DOCUMENT where `:root` does
 *    match, it computes to #fcfcfc. On a pale panel that is an invisible
 *    checkbox: present, clickable, and impossible to find.
 *
 * Both measured in Chromium, which is also why the fix is a `--border-*` token
 * rather than a hex: those are declared under `:host` and per theme.
 *
 * **The checked state was a no-op.** `data-[state=checked]:bg-bg-primary` sets
 * the background the box already has, so the only difference between checked
 * and unchecked was a 12px tick drawn in the text colour. It now fills, which
 * is what makes a ticked row scannable in a list of them.
 *
 * The mirrored `useState`/`useEffect` that used to sit here is gone with them.
 * It re-rendered on every change to say what `data-state` already says, and it
 * got `defaultChecked` wrong: an uncontrolled checkbox that starts checked has
 * no `props.checked` to mirror, so it rendered with no tick until someone
 * clicked it twice. Which icon to draw is now a CSS question about the state
 * Radix already publishes.
 */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer group/checkbox h-4 w-4 shrink-0 rounded-sm",
      "border border-border-primary bg-bg-primary",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
      "disabled:opacity-50",
      "data-[state=checked]:bg-bg-brand-primary data-[state=checked]:border-border-brand-primary data-[state=checked]:text-fg-brand-primary",
      "data-[state=indeterminate]:bg-bg-brand-primary data-[state=indeterminate]:border-border-brand-primary data-[state=indeterminate]:text-fg-brand-primary",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("flex items-center justify-center text-current")}
    >
      {/* The Indicator renders only when checked or indeterminate, so which of
          the two is a CSS question - and a named group, because a checkbox can
          sit inside a row that is itself a `group`. */}
      <Check
        size={12}
        aria-hidden
        className="group-data-[state=indeterminate]/checkbox:hidden"
      />
      <Minus
        size={12}
        aria-hidden
        className="hidden group-data-[state=indeterminate]/checkbox:block"
      />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
