---
"@valbuild/ui": patch
---

Add an `ask_user_question` AI tool so the assistant can ask 1-4 structured clarification questions instead of guessing at an ambiguous request. Questions render as a card in the chat with single- or multi-select options, optional pre-selected defaults, a free-text "Other" answer per question, and Submit/Cancel.

Each question is a real ARIA group: single-select questions are a `radiogroup` of `radio`s with arrow-key navigation and a single tab stop, multi-select questions are a group of `checkbox`es, and the "Other" row participates as the last choice so it is reachable by keyboard and counted in screen-reader announcements.

Tool definitions can now declare a `timeoutMs`, controlling how long the server waits for the matching tool result: omitted keeps the 30s default, a number overrides it, and `null` waits indefinitely. `ask_user_question` uses `null` since it blocks on the user.

Because the tool holds the turn open, the client is careful not to leave it stuck: it suspends its own in-progress message timeout while a card is open (restarting the clock once the user acts, so it measures server time rather than thinking time), rejects unanswered questions when the user starts or switches session, validates the question payload before rendering, and fails the turn locally with a retry if the answer cannot be delivered because the connection dropped.
