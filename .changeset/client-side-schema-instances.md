---
"@valbuild/core": minor
"@valbuild/server": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
---

The Studio now uses your real schema instances, which makes `.render()` work again and runs `.validate()` in the browser for the first time.

The Studio had been rebuilding schemas from their serialized form, and serialization cannot carry functions. Two features were silently lost to that: the `select` function of a `.render()` layout, and every custom `.validate()` function. Where the registry is available — any app rendering `<ValModulesClient>`, which the Next integration does — the Studio now keeps the instances themselves.

**`.render()` layouts work again**, for every schema type. They are also computed from the source WITH your unpublished changes applied, so a list row's title updates as you type rather than after publishing. A record whose entries are lazily loaded renders the rows it has and leaves the rest as placeholders.

**`schema.validate(fn)` now runs client-side.** Structural validation continues to run in a worker; your validate functions run on the main thread against the real schema, time-sliced so a module with many of them cannot make the editor unresponsive, and their errors are merged with the structural ones rather than replacing them. They run when you edit a module and once more before publishing — never merely on opening the Studio, so loading a project does not execute project code. For a `.jsonValues()` record, entry content a validator needs is loaded first; a validator on the RECORD itself needs every entry, so prefer putting validators on the item schema where one key suffices.

> **Heads up: you may see validation errors that were previously invisible.** Custom validate functions have never run in the Studio before, so a project whose content violates one will start reporting it — and since the publish gate reads validation errors, some of those will block publishing until the content or the validator is fixed. The errors are real; only their visibility is new.

The server no longer computes renders for the Studio: `ValOps.getRenders` and the `render` field on the `/sources/~` response are removed, as nothing consumed them once renders became client-side.
