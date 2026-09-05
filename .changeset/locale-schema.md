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

**Aliases** spell a locale differently where it is stored, which is what a URL
segment needs:

```typescript
s.locale().aliases({ "en-US": "en", "nb-NO": "no" }); // stored: "en" | "no"
s.locale().aliases({ "en-US": ["us-sales", "us-support"] }); // several spellings, one language
```

The aliases **replace** the tag rather than adding to it: with the first of
those, `nb-NO` is no longer a value that field accepts. If both were accepted one
page could exist at `/no/foo` and at `/nb-NO/foo` — two keys for one language,
and duplicate content nobody would notice. A partial map is a subset, so a map
that says nothing about `fr-FR` is how a field says it has no French.

A locale is **never stega encoded**: it ends up in `<html lang>`, in `hreflang`
and in `Intl` constructors, none of which survive invisible characters.

`assistant.translation` joins the settings module alongside `context` and `tone`
— a note per language, keyed by language, so only the target language's rules are
sent when translating into it.
