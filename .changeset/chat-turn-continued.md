---
"@valbuild/ui": patch
---

**The assistant's chat no longer gets stuck after it is opened again mid-answer.** Picking the open chat from History while the assistant was still answering made the answer vanish, and if the assistant then asked for code mode or asked a question, that card was never shown. The chat stayed blocked waiting for it, and every new message was refused with "Someone else is asking in this chat" until a new chat was started. Opening the chat that is already open now leaves it as it is, and opening another chat stops the answer that is running first.
