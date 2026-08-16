---
"@valbuild/ui": patch
---

Fix the button sizing and alignment in the Val menu overlay.

The publish button rendered as a full-size, labelled button ("Ready" / "Save" plus icon) inside a bar where every other control is a 34px icon button, which made the menu much larger than it needs to be — most visibly in the default `right-center` drop zone, where the label sets the width of the whole vertical bar. It now renders icon-only in the overlay, with the label moved into a tooltip. The bar in the Studio toolbar is unchanged.

The buttons also had three different box models, so they came out at three different heights: `MenuButton` used `inline-block` with `leading-4`, the overflow (`…`) trigger used the browser default line-height, and both put the icon on a text baseline, where the descender space below it depends on the inherited line-height. The shared button class is now `inline-flex` and centers its icon, so every button is exactly icon + padding + border.

Two smaller layout fixes in the same menu: the separator was a zero-width element that only ate gap in the horizontal layouts (it is now a rule in both directions), and the pending-changes badge wrapper around the compare icon added baseline space that made that one button taller than its neighbours.
