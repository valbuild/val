---
"@valbuild/ui": patch
---

The assistant in code mode checks its changes beside the conversation, not in it, so you can keep going while they run.

- After each code change, the Studio typechecks and lints the proposal in the background. Whatever those checks find goes with the assistant's next tool answer, whichever tool that is, once for each version of the files.
- A page check, which is a second assistant on a smaller model, reads the preview once the assistant's turn ends, or after 30 seconds without another change. It only reads: it never changes code or content, and never clicks. Its report reaches the assistant the same way, and only while it is about the files as they are now.
- The assistant no longer waits for a typecheck in the middle of a turn. It stages the change, says so and ends its turn, and the checks report back afterwards. A turn in code mode ends as soon as the change is in the preview, so you can write your next message sooner.
- The assistant can start a page check itself with `verify`, saying what to look at, and send a running one a note with `message_verifier`.
- When a check finds a problem after the assistant's turn has ended, the Studio sends it the findings in a turn of their own. The chat shows that message as a notice, not as yours. If you have a message waiting, nothing extra is sent: the findings go with your message.
- A bar above the composer shows each check as it runs, and when the assistant is fixing what one found.
- The assistant gets at most 2 of these automatic fixes for each message you send, and none when its last fix changed nothing the checks find. After that, the bar lists what is still wrong, and **Fix it** asks for it as your message. At most 3 page checks run per message, so the checks and the assistant cannot keep each other going.
