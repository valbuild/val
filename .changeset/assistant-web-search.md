---
"@valbuild/core": patch
"@valbuild/ui": patch
---

The assistant can search the web, if you turn it on.

Settings → Assistant has a new switch, **Search the web**. It is off unless someone turns it on (`assistant.webSearch: true` in `settings.val.ts`). When it is on, the assistant can look things up online with your AI provider's own search, and each search is billed to your project's AI key. You can see each search in the chat.

Web pages can contain instructions written for AI assistants, so after the assistant has searched the web, it asks you before it changes the site's code or builds it. The question comes from Val, not from the assistant. Content edits are not affected: they stay drafts you can review and revert, as before.

Needs a Val Build version with web search. With an older one, nothing changes.
