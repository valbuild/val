---
"@valbuild/ui": patch
---

The assistant in code mode checks its changes beside the conversation, not in it, so you can keep going while they run.

- After each code change, the Studio typechecks and lints the proposal in the background. Whatever those checks find goes with the assistant's next tool answer, whichever tool that is, once for each version of the files.
- A page check, which is a second assistant on a smaller model, reads the preview once the assistant's turn ends, or after 30 seconds without another change. It only reads: it never changes code or content, and never clicks. Its report reaches the assistant the same way, and only while it is about the files as they are now.
- The assistant can start a page check itself with `verify`, saying what to look at, and send a running one a note with `message_verifier`.
- At most 3 page checks run for each message you send, so the checks and the assistant cannot keep each other going.
