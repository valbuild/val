---
"@valbuild/ui": minor
"@valbuild/shared": minor
---

Publishing no longer waits on the AI, and chat turns can be stopped.

The publish summary box opens filled with a summary built locally from the
changed modules and is editable from the first frame. It used to disable its
textarea and blank the text while the AI wrote, so a typo fix meant waiting on
a model before you could type. The AI is now an offer beside the heading: it
fills a box you have not touched, or is offered as "Use AI summary" if you have
started writing. Pressing Publish while it is still writing publishes after a
short grace period, and pressing Publish again skips the wait.

The chat's send button becomes a stop button while the assistant is streaming.
Stopping aborts the request on the server rather than only stopping the client
listening, which matters when the call runs on your own API key.

Also fixes AI error messages being dropped in the Studio: the error code list
was strict and had fallen behind the content server, so newer codes failed to
parse and the turn appeared to hang instead of reporting why it stopped.
