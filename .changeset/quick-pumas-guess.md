---
"@valbuild/shared": patch
---

Show the reason behind a content-service error instead of just "Internal Server
Error".

`content.val.build` answers a handler that threw with `{ message: "Internal
Server Error", details: "<the actual cause>" }`. Val was reading `message` and
dropping `details`, so a failed save put exactly this in front of an editor —
and the same text in the app's own logs, because Val was relaying it:

```json
{ "type": "patch-error", "message": "Internal Server Error", "errors": { … } }
```

A string `details` is now appended to the message (capped at 500 characters).
A structured one is not: that is what a _refusal_ carries, and its summary is
already the message.
