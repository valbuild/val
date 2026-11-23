---
"@valbuild/ui": patch
---

The assistant no longer goes quiet while it works out a change.

- While it thinks, the chat shows one line of what it is thinking about. The line goes away as soon as it starts to answer or to do something. (Claude models only.)
- When it starts to change a file, the chat says so at once, with the file's name: "Changing the code: src/components/Hero.tsx…". Before, nothing showed until the whole file had been written, which could take many seconds.

Both need a content server that sends them; with one that does not, nothing changes.
