---
"@valbuild/ui": patch
---

Publishing no longer gets stuck at "Building", and a publish from Safari or an iPhone keeps the edit it was made for.

- **The site builder runs in a Web Worker.** It ran on the page, and rolldown's threaded WebAssembly sometimes has to wait for one of its own threads, which a page is not allowed to do. The build then stopped with no error and "Building" spun forever. How often depended on timing, and it happened in every browser, most visibly on iPhones. In a worker the same builds finish every time. If a build ever does stop answering, the publish now fails after five minutes with a message, instead of spinning.
- **The builder tab builds from the files the save wrote,** as a publish built in the Studio does. It used to rely on reading the project's current source back from the site, so a publish from Safari could go live without the edit it was made for.
