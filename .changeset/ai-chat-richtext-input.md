---
"@valbuild/ui": minor
---

The AI chat input is now a rich text editor instead of a plain textarea.

Messages can carry formatting (bold, italic, lists, links, code), pasted or dropped inline images, and "mention field" chips that reference a specific module path. Bold/italic/list markdown shortcuts work as you type, and a floating toolbar appears on selection.

Every field in the editor gets a "Mention this field in AI chat" action that opens the chat and inserts a reference to that field, so you no longer have to describe by hand which content you mean.

Inline images are extracted from the message and uploaded as `image_key` blocks, so the assistant receives them alongside the text rather than as an opaque blob.
