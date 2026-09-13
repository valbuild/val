---
"@valbuild/core": minor
"@valbuild/ui": minor
---

Settings: declare the languages a project publishes.

A new `locales` section in the settings module says which languages a project
has:

```typescript
export default c.define("/settings.val.ts", s.settings(), {
  locales: {
    available: ["en-US", "fr-FR", "nb-NO"],
  },
});
```

The order is the project's own and is kept rather than sorted: it is the order
of the Studio's locale picker and of the rows in a locale-keyed record. There
is no default language — every locale-specific field asks which language it is
in, and a default is the answer that lets that question go unanswered.

Like every other settings section it is optional, so a project that is not
translated writes nothing and sees nothing: no locale controls appear anywhere
until `available` has something in it.

This is content rather than configuration, and deliberately: which languages a
site has is a decision the people who write it make, and under a build-time
constant it took a developer and a deploy. It is the same move `assistant`
already makes with `enabled`.

Tags are BCP 47 (`en-US`, `nb-NO`), checked through `Intl.getCanonicalLocales` —
the same implementation `<html lang>` and every `Intl` constructor use — and
they have to be in canonical form. `nb-no` parses, but nothing else in the stack
agrees it is the same string as `nb-NO`, and a locale is compared as a string
everywhere it is used. Validation names the spelling to use, and reports a
language declared twice on the repeat rather than on the list — that is the row
to delete, and a message on the list itself would not say which.

Edited under Settings → Locales in the Studio, which names each language in its
own language.
