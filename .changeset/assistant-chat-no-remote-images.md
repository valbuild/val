---
"@valbuild/ui": patch
---

The assistant's replies no longer load images from the web, and every link in them shows where it goes.

An image in a reply (`![…](https://…)`) used to load as soon as the reply appeared. The assistant reads content and pages it did not write, and text in them can steer it, so a reply could make your browser send data to someone else's site without you clicking anything. Images in replies now show as `[image: …]`, the way they already did in the message box. Images the assistant made in the session are shown as before.

A link in a reply now shows its site next to the text, for example "the docs (example.com)", unless the text already is the address. Links open in a new tab without telling the site where you came from.
