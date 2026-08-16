---
"@valbuild/ui": patch
---

Make the tooltip on the publish button in the Val menu reachable and give the icon-only button a name that says what it does.

The button is icon-only in the menu, so the tooltip is the only place it explains itself — but it was unreachable in exactly the states where it matters most. `TooltipContent` rendered inline, and the menu sits inside a transformed, `overflow-hidden` wrapper that clips the (position `fixed`) tooltip away entirely; it now takes a `container` and is portalled out of the menu, the same way `HoverCardContent` already is. And when the button is disabled — validation errors, nothing pending — the design system makes it `pointer-events-none` and takes it out of the tab order, so it could receive neither hover nor focus: the tooltip now hangs off a focusable wrapper that carries the name and disabled state of the action instead.

The accessible name of the compact button was `"Ready"` / `"Save"`, which is the state it is in rather than what pressing it does. It is now the same wording as the tooltip: "Publish pending changes", "Pushing changes", "Save to disk", "Saving changes to disk". The full-size button in the Studio toolbar keeps its visible label as its name, so the two still match.
