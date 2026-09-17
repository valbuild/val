---
"@valbuild/server": minor
---

Say `VAL_MODE=memory` where there is no disk, and get a sentence instead of an `EPERM`

Memory mode — the one for a host that holds the project's source itself — is
selected by passing `sourceFiles`, and it has to be: nothing in an environment
can supply a project's source, so a mode that an env var could switch on would
be a server with no content in it.

The cost was the failure when a host forgot. Val inferred `fs` mode, `fs` mode
went looking for a working tree, and in a Worker isolate the first thing to
touch the disk failed:

```
patch-error /bundle/.val/patches.lock: EPERM
```

That names a path two layers below the decision that caused it, and nobody
reading it would guess "your server was configured for the wrong mode".

So an environment can now DECLARE that it has no disk:

```
VAL_MODE=memory
```

It does not turn memory mode on. It says the host is supposed to be supplying
`sourceFiles`, so if none arrive, Val refuses at configuration time and says
which call is missing them. A value other than `memory` is refused too, rather
than quietly leaving you in `fs` mode — which is the exact failure the variable
exists to prevent.

Nothing changes for an app that does not set it: `http` when `VAL_API_KEY` and
`VAL_SECRET` are both present, `fs` otherwise, as before.
