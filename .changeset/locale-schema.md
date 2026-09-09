---
"@valbuild/core": minor
"@valbuild/shared": minor
"@valbuild/react": minor
"@valbuild/ui": minor
"@valbuild/server": minor
---

`s.locale()`: one of the project's languages.

The languages themselves are declared in the settings module (`locales.available`);
this says that a value is one of them.

```typescript
// a field: everything in this entry is in this language
s.record(s.string(), s.object({ locale: s.locale(), title: s.string() }));

// a key: one entry per language
s.record(s.locale(), s.object({ title: s.string() }));
```

Every locale in content is checked against the project's list, the way `keyOf`
and `route` are checked against what they point at. An undeclared language names
the ones the project has; a project that has declared none is told to declare
them rather than told the value is wrong.

A locale is stored as the tag itself — the value in content is `nb-NO`, and a
record keyed by `s.locale()` has `nb-NO` as its key. Spelling one differently
where it is stored (`/no/…` as a URL segment) is a real need and is deliberately
not in this release: it changes what is accepted as well as what is shown, so it
is being designed on its own rather than folded in here.

A locale is **never stega encoded**: it ends up in `<html lang>`, in `hreflang`
and in `Intl` constructors, none of which survive invisible characters.

`assistant.translation` joins the settings module alongside `context` and `tone`
— a note per language, keyed by language, so only the target language's rules are
sent when translating into it.
