---
"@valbuild/ui": patch
"@valbuild/shared": patch
"@valbuild/server": patch
---

A proposal's shared AI chat now shows other people's turns live: their question appears as they send it, each tool the turn runs shows as a step, and the answer streams in as it is written, instead of turning up a few seconds later. Who is asking is what the content server says rather than a guess. Against a content server that does not relay chats yet, the Studio falls back to reading the chat again every few seconds, as before.

An answer's tool steps are now also shown when a chat is opened again or the page is reloaded, for every chat on a content server that keeps them.
