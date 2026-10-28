---
"@valbuild/ui": patch
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
---

The Studio now shows which versions of Val it runs. Open the Account panel (the button at the foot of the left rail) and click the grey line at the bottom, for example `TanStack · Val 0.150.8`, to see:

- what your app's server runs: `@valbuild/next` or `@valbuild/tanstack`, `@valbuild/core` and `@valbuild/server`
- what the Studio in your browser loaded: `@valbuild/ui`, and the `@valbuild/core` bundled into it

**Copy all** puts the list on the clipboard, ready to paste into a bug report. The server's half comes from a new `GET /api/val/versions` route, which needs the same sign-in as the rest of the Studio. If your server's Val is older than the Studio, the list says so and still shows the Studio's half.
