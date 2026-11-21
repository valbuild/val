---
"@valbuild/ui": patch
---

You can now redirect the assistant while it works, without pressing Stop. A message you send while your own question is being answered goes to the assistant at once, and it reads it at its next step: "only the blog posts, not the pages" changes the answer that is already under way.

- The message shows in the chat straight away, marked "Sent; the assistant will read it at its next step". Once the assistant has it, it becomes an ordinary message, in the place it was read: between what the assistant did before it and what it did after.
- Once sent, it cannot be edited any more, and the chat says so.
- If the answer finishes before the assistant takes another step, the message is sent as your next question, in the order you wrote it.
- If the assistant cannot take it right now (for example, because five messages are already waiting), it says why and queues the message instead: it is sent when the answer is done, and you can edit or remove it in the queue until then.
- A message is only ever sent to the chat it was written in. If you open another chat while the assistant is still working, what you sent stays with the first chat; anything that chat's answer did not get to read is kept for you, with Edit and Remove, and is not sent anywhere by itself.
- If the turn fails and you press Retry, the question is asked again together with the messages you sent into it, in order.
- Pressing Stop puts anything the assistant has not read yet back in the queue, where it waits for you, as queued messages always have.
- With a content server that cannot do this yet, nothing changes: after a few seconds without an answer, the message waits in the queue and is sent when the answer is done, as before.

In a proposal's shared chat, a message you write while someone else's question is running still waits for it to finish.
