---
"@valbuild/shared": patch
"@valbuild/server": patch
"@valbuild/ui": patch
---

**Sketchpad**: work out a page's content and rough layout with the assistant before anyone builds it.

A sketchpad is a document of headings, text, boxes and columns, where you edit the text in place, and boxes can hold images and videos. The assistant sees the same sketch as text in one strict format, so what it reads is what is on screen. It has tools to list, create, read and write sketchpads, and **Send to AI** asks it to read the one you are on.

- Sketchpads live on the server, apart from any chat or page. They outlast the chat they started in, and the page a sketchpad is about can be changed. A sketchpad can be archived and reopened.
- Open one from a page's menu (**Sketch changes**), from the top bar, or when the assistant offers one.
- On a desktop the page, the sketchpad and the chat sit side by side; the chat now docks beside the work area. On a phone a sketchpad can go full screen, with the page one tap away and the buttons at the bottom.
- In local development sketchpads are stored in `.val/sketchpads/`. A hosted project needs the content host's sketchpad API; without it the Studio does not offer sketchpads.
