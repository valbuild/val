---
"@valbuild/server": minor
"@valbuild/tanstack": minor
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
where to pass them. `VAL_MODE=` counts as unset, the way a shell means it; any
other value is refused rather than ignored, since leaving you in `fs` mode is
the exact failure this is meant to catch.

**`initValContent` takes the same options, and this is the release that
noticed.** It builds a Val server of its own — these readers resolve content by
asking it, not by calling the API over HTTP — so configuring `initValServer`
alone left them inferring `fs` mode. On a host with no filesystem that is a
reader looking for a working tree that is not there; it went unnoticed because
published reads still worked.

```ts
const patchStore = new InMemoryPatchStore(); // now exported from this package

const { valApiHandler, draftMode } = initValServer(valModules, config, {
  sourceFiles: FILES,
  patchStore,
  unsafelyAllowUnauthenticated: true,
});

const { fetchValStega } = initValContent(config, valModules, {
  draftMode,
  // The same three. Two patch stores are two sets of pending edits, and a
  // reader that checks a session the host never issues answers itself 401 and
  // falls back to published content — a draft render showing the live site.
  sourceFiles: FILES,
  patchStore,
  unsafelyAllowUnauthenticated: true,
});
```

All three are optional. Left out, this reader gets its own store and its own
answer about authentication, which is right for published content.

`@valbuild/next` has no memory mode: its `initValServer` takes neither option,
so for a Next app `VAL_MODE=memory` names an environment Val cannot serve from,
and the error says so.

Nothing changes for an app that sets none of this: `http` when `VAL_API_KEY`
and `VAL_SECRET` are both present, `fs` otherwise, as before.
