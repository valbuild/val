---
"@valbuild/ui": patch
---

The AI assistant now shows how long a reply is taking and how many tokens it has written, under each reply.

- **While the assistant works**, a line under the reply says what it is doing — `Thinking…`, `Writing…`, or `Working…` while it runs a tool — with a timer and a count of output tokens that climbs as it goes: `Working… 1m 05s · ↓ 2.1k tokens`. The count also moves while a model thinks or writes a large edit before saying anything, where the service reports it. This line replaces the three dots.
- **When the assistant asks you a question**, the timer pauses and the line reads `Waiting for your answer`, so the time shown is the assistant's, not yours.
- **When the reply is done**, the line settles to the total: `1m 34s · 3.4k output tokens`. A stopped reply says `Stopped after 18s`, a failed one `Failed after 31s`. A count marked `~` is an estimate made in the browser, shown when the service did not report an exact one.
- Only **output** tokens are counted: what the model wrote, including its thinking and tool calls. The context sent back to the model on every tool call is left out.
- Conversations reopened from history show no timer or count. Those are only kept for replies you watched arrive.
