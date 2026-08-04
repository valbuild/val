---
"@valbuild/ui": patch
---

Add an `ask_user_question` AI tool so the assistant can ask 1-4 structured clarification questions instead of guessing at an ambiguous request. Questions render as a card in the chat with single- or multi-select options, optional pre-selected defaults, a free-text "Other" answer per question, and Submit/Cancel.

Tool definitions can now declare a `timeoutMs`, controlling how long the server waits for the matching tool result: omitted keeps the 30s default, a number overrides it, and `null` waits indefinitely. `ask_user_question` uses `null` since it blocks on the user. The client mirrors this by suspending its own in-progress message timeout while a question card is open, and rejects any unanswered question when the user starts or switches session so the conversation is never left blocked.
