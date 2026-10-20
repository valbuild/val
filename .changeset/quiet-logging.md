---
"@valbuild/core": patch
"@valbuild/shared": patch
"@valbuild/server": patch
"@valbuild/react": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
"@valbuild/ui": patch
---

Val is quieter in your app's console. Errors and warnings you can act on still
print, now prefixed with `[val]` so you can filter them. Val's own debug
output, which used to reach your terminal and browser console, is now off by
default. That includes the `Invalid JWT` line that printed on every request
with an expired session cookie, the "verifying draft mode" and polling notices,
and the Studio's sync and WebSocket chatter.

To turn the debug output back on, for example when reporting a bug:

- on the server, set `VAL_DEBUG=1`
- in the browser, run `localStorage.setItem("val:debug", "1")` in the console.
  It takes effect immediately, with no reload. Remove the key to turn it off
  again.
