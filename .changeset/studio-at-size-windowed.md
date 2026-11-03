---
"@valbuild/ui": patch
---

The Studio stays responsive next to large media libraries and records.

- **Typing no longer freezes on a page that picks from big libraries.** A field on a page whose images, files or videos come from libraries of 10,000 entries froze for about a second per keystroke (14 s at 100,000). Every keystroke recounted every `.jsonValues()` entry in the project, scanned every library for references, and re-sorted every library's file list. Each of those now happens only when what it reads changes, so a keystroke costs the same however big the libraries are.
- **The image, file and video gallery shows only the tiles on screen.** A library of 10,000 images used to load 10,000 thumbnails at once, and a library of 100,000 crashed the tab. The grid and the list now render the rows you can see, fetching only those pictures, and scrolling stays smooth. Search, selecting, uploading and drag and drop work as before. An entry opened from a link is scrolled into view.
- **Reference dropdowns open instantly however many entries they list.** A `keyOf` field, or a route field, pointing at 10,000 entries froze for over two seconds when opened, and at 100,000 did not open. The list now renders only the options on screen. Search filters across all of them, and the arrow keys, Home and End reach any option. The list opens on the current value, and the search box has the focus as soon as it opens.
