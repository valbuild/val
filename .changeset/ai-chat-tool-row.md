---
"@valbuild/ui": minor
---

The AI assistant's tool calls are now a row of their own above the answer,
collapsed to a summary you can expand.

They used to be listed inside the assistant's own bubble, one line per call, so
a turn that read a schema, searched, read a source and wrote a patch pushed its
answer off the bottom of the panel — the part you were waiting for was the part
you had to scroll for. The row now says what is happening ("Reading content…"
while it runs, "Used 5 tools" when it is done) and the list is behind a
disclosure.

While a call is in flight its label shimmers, so the row shows the turn is
still working without a spinner to stare at. It marks a call as pending, not as
healthy: a stalled call stays pending, and goes on shimmering until the turn
times out.

`ask_user_question` cards stay outside the collapsible and always visible: the
turn is blocked until one is answered, and hiding it leaves a session that has
visibly stopped with nothing on screen saying why.
