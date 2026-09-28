---
"@valbuild/ui": patch
---

The focal point of an image is now saved where you click, images are shown centred on it, and the image field has a new look.

- **The saved focal point was wrong for images narrower than the field.** A portrait photo was letterboxed inside the picker, so a click was measured against the empty space around the picture as well as the picture itself, and then shifted 6px up and to the left. Clicking a subject at 70% across could save 55%. Clicks now land exactly where the marker is drawn. You can also drag the point, and a drag saves once when you let go. Focal points saved before this fix are not changed; re-pick any that look off.
- **The image preview dialog is centred on the image.** It used to fill most of the screen, with a portrait image pinned to its left edge and the focal-point marker drawn in the empty space beside it. The dialog is now the size of the image, the marker is on the picture, and a footer shows the file name, dimensions and focal point.
- **Thumbnails are cropped around the focal point.** They used to shrink the whole image into the tile, which showed a portrait image as its top strip and a landscape one as a thin band. Thumbnails in image fields, galleries and the media picker now fill the tile and keep the focal point, or the centre when none is set, in frame. Images smaller than the tile are still shown at their own size rather than enlarged.
- **The image field shows the image as a page would.** A 16:9 preview cropped around the focal point replaces the small thumbnail, with the file name, dimensions, type and focal point under it. Click it to see the image large. Replace and Remove appear over the image on hover, and stay visible on touch screens and while a keyboard is focused on the card.
- **Drop an image onto an image field** to upload it. An empty field is a drop zone, and dropping onto a filled one replaces the image.
- **Upload progress** is a bar along the bottom edge of the field instead of a spinner over the picture.
- **Transparent images show a checkerboard** behind them (PNG, WebP, GIF, AVIF and SVG), in the field, the focal point picker and the large preview, so a logo on a transparent background is visible in dark mode too.
