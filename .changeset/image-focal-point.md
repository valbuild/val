---
"@valbuild/ui": patch
---

The focal point of an image is now saved where you click, and images are shown centred on it.

- **The saved focal point was wrong for images narrower than the field.** A portrait photo was letterboxed inside the picker, so a click was measured against the empty space around the picture as well as the picture itself, and then shifted 6px up and to the left. Clicking a subject at 70% across could save 55%. Clicks now land exactly where the marker is drawn. You can also drag the point, and a drag saves once when you let go. Focal points saved before this fix are not changed; re-pick any that look off.
- **The image preview dialog is centred on the image.** It used to fill most of the screen, with a portrait image pinned to its left edge and the focal-point marker drawn in the empty space beside it. The dialog is now the size of the image, the marker is on the picture, and a footer shows the file name, dimensions and focal point.
- **Thumbnails are cropped around the focal point.** They used to shrink the whole image into the tile, which showed a portrait image as its top strip and a landscape one as a thin band. Thumbnails in image fields, galleries and the media picker now fill the tile and keep the focal point, or the centre when none is set, in frame. Images smaller than the tile are still shown at their own size rather than enlarged.
