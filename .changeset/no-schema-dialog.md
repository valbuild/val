---
"@valbuild/ui": patch
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/tanstack-build": patch
---

**No more "A new version has been deployed" dialog.** A Studio that is open
while the site is deployed no longer stops you with a dialog you can only
answer by reloading. Instead:

- **On Val's hosting**, the Studio takes the new build's fields in where you
  are, without reloading: a field the deploy added can be filled in at once,
  and the assistant's chat, the page you were on and your unsaved edits stay
  as they were. Each build now carries its content schemas as a small file of
  its own beside its scripts, which the Studio loads.
- **Anywhere else** (a Next.js site, or a TanStack Start site hosted
  somewhere else), the Studio reloads itself a few seconds after the deploy,
  once everything you typed has been saved. Nothing is lost: where you were is
  in the address, and every edit is on the server.
- **In local development** nothing changes: your dev server's hot reload
  brings the new fields, as before.

When a deploy upgrades Val itself, the Studio reloads itself the same way,
since its own code changed too.
