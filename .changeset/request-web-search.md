---
"@valbuild/core": patch
"@valbuild/ui": patch
---

The assistant can ask you to turn on web search, when it needs it.

If **Search the web** (Settings → Assistant) has not been decided yet and a question needs something from outside your project, the assistant now asks you to turn it on. The question comes from Val, with the assistant's reason quoted.

- **Turn on web search** turns it on for the project. Searching works from your next message.
- **Don't turn on** turns it off, and the assistant will not ask again.
- Closing the card decides nothing.

If web search is off, the assistant never asks. The assistant cannot change this setting itself: only you can, from that card or in Settings.
