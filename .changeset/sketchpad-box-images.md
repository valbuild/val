---
"@valbuild/ui": patch
---

Images in a sketchpad's boxes now show when the sketch names them by their content path, as the assistant does when it fills a sketchpad from an existing page (`/public/val/hero.webp`). They are loaded from where the site serves them, and an image that is uploaded but not yet published is shown too. The sketch keeps the path, so the assistant builds the page with the same image.
