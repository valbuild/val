---
"@valbuild/ui": patch
---

Put the real assistant in the studio shell, and fix two bugs it was hiding

The floating shell's AI panel was a design stand-in: it echoed what you typed
into local state and called no tools. The wired assistant was in the classic
layout, behind `?val-ui=classic`. So the studio shipped a panel that looked
exactly like a working assistant and was not one.

There is now one assistant, in the shell, mounted for as long as the studio is —
dismissing the panel hides it rather than unmounting it, so a turn in flight is
not dropped by a stray click in the editor. `?val-ui=classic` and the classic
layout it was the only way into are gone.

Two bugs the new end-to-end coverage found, both of which broke AI-written
images silently:

- An image the editor attached in the chat was destroyed the moment it was
  transferred. Such a patch's `file` op carries a session key where every other
  one carries bytes, and the store uploaded that key as the file's contents,
  over the image the content service had just written. The image 404'd in the
  studio and a publish committed a UUID in place of the file, with the tool
  reporting success throughout.
- Every assistant reply rendered twice in development, because the finished
  message was appended from inside a state updater and `StrictMode` runs those
  twice.

Also fixed while wiring the shell: being signed out of the assistant showed a
generic "unavailable" message with a retry that could only fail again, instead
of the prompt that says how to sign in; and the studio's global errors — the
network and schema banners, and the dialog that tells you to run
`npx -p @valbuild/cli val login` when remote files need a personal access token
— are rendered again, having been left behind in the classic layout.
