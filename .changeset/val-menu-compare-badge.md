---
"@valbuild/ui": patch
---

Make the pending-changes count on the compare button in the Val menu easier to spot.

The badge is extracted into a `PendingChangesBadge` component that replaces four overlapping inline conditionals with a single count: validation errors in red when there are any, otherwise pending changes, capped at "9+".

Visually it now sits fully inside the button instead of 3px outside it — so it stays clear of the menu's `overflow-hidden` wrapper and of the viewport edge in the left/right drop zones — and it has a 2px ring in the menu background color so it reads as a separate dot on top of the icon rather than blending into the button. The green variant uses the `fg-brand-primary` token that pairs with its background instead of inheriting the menu foreground, and the badge grows for "9+" (`min-w` + horizontal padding) rather than being a fixed 16px box.

It also renders when there are validation errors but no pending patches, which previously showed no badge at all, and carries an `aria-label` ("3 pending changes" / "1 validation error") so the count is announced.
