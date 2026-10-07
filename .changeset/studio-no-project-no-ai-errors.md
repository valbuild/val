---
"@valbuild/ui": patch
"@valbuild/server": patch
---

Fixed: a project that is not connected to Val Build yet (no `project` in `val.config`) no longer gets errors from the Studio on every page load. The Studio used to ask for the assistant, its conversations and the project's members anyway, and got `401` and `500` answers that showed up in the browser console and as an issue badge in the Next.js dev overlay. It now asks only once there is a project to ask about, and the assistant is hidden until there is. The chat used to say "Login to use AI chat" in that state, which no login could fix.

A project named only in the `VAL_PROJECT` environment variable counts as connected, as it always did on the server.
