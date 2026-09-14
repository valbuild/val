---
"@valbuild/ui": patch
---

The Studio's URL no longer carries a canvas position when the canvas is closed

Every link copied out of the Studio came with `canvas-at=1.00%2C0%2C0` on it,
whether or not the canvas had ever been opened. The workspace reports where it
is from the moment it mounts — which it does regardless of whether it is on
screen — and that position was written to the URL unconditionally.

It is now written only alongside `canvas=1`, and closing the canvas takes it
with it. Nothing about restoring a canvas changes: a link to one still carries
its zoom and pan, and still opens on the view it was copied from.
