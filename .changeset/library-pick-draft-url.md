---
"@valbuild/core": patch
---

A field that picks an image, file or video from a library (`s.image(imagesVal)`,
`s.file(filesVal)`, `s.video(videosVal)`) now gets the right url on a draft page
when the file was uploaded in an unpublished change. The server-rendered page
used to name the file at its published url, where nothing exists until the
change is published, so the image or video was broken until the Studio's
preview replaced it.
