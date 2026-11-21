---
"@valbuild/ui": patch
---

You can now redirect the assistant while it works, without pressing Stop. A message you send while your own question is being answered goes to the assistant at once, and it reads it at its next step: "only the blog posts, not the pages" changes the answer that is already under way.

- The message shows in the chat straight away, marked "Sent; the assistant will read it at its next step". Once the assistant has it, it becomes an ordinary message, in the place it was read: between what the assistant did before it and what it did after.
- Once sent, it cannot be edited any more, and the chat says so.
- If the answer finishes before the assistant takes another step, the message is sent as your next question, in the order you wrote it.
- If the assistant does not take it, the reason is shown and the message is put back in the box, so nothing you wrote is lost.
- Pressing Stop puts anything the assistant has not read yet back in the queue, where it waits for you, as queued messages always have.
- With a content server that cannot do this yet, nothing changes: after a few seconds without an answer, the message waits in the queue and is sent when the answer is done, as before.

In a proposal's shared chat, a message you write while someone else's question is running still waits for it to finish.
