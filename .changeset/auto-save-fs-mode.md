---
"@valbuild/ui": patch
"@valbuild/server": patch
---

Make auto-save work in dev, and stop a publish overlapping a keystroke from double-applying it

The Auto-save toggle has never worked correctly, for three independent reasons.

- `POST /save` finished by deleting the whole patch store, so anything typed
  while it ran was thrown away — never applied, and indistinguishable on screen
  from having been saved. It now deletes exactly the patches it consumed.
- One unappliable change refused the entire commit, for every module, and stayed
  on disk to fail the same way next time. On a timer that is not a refusal but a
  dead stop. In dev the failing change and the rest of its module's chain are
  removed instead, the rest is written, and the person editing is told what went
  and why. A module that could not be read at all keeps everything: the file is
  what failed, not the changes.
- The client refused to publish whenever the chain was moving, which on a timer
  means never. It now names a batch, and publishes the longest prefix of it the
  server already has — never an arbitrary subset, because committing a change
  while an earlier one stays pending would write a file no ordering of the rest
  explains.

Auto-save runs on a pause in typing rather than on every change, and once
everything is on disk it validates the whole project and says so. It is a dev
mode feature and the toggle is shown only there.

Also fixed, and older than auto-save: publishing while someone was typing baked
the whole displayed value into the base while removing only what was published,
so the changes still pending were applied twice. Invisible for a replace, which
is most typing; an array insert appeared twice with nothing to explain it.
