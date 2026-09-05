---
"@valbuild/core": minor
"@valbuild/shared": minor
---

Locale scopes: a subtree in one language, and one function that answers which.

A **locale scope** is content governed by a single language. Two things open one
today (a third, locale segments in routes, follows):

```typescript
// a locale field: this object and everything below it is in one language
s.object({ locale: s.locale(), title: s.string(), body: s.richtext() });

// a locale-keyed record: each entry is in the language its key names
s.record(s.locale(), s.object({ title: s.string() }));
```

**A scope may not contain another scope**, and an object may have only one
locale field. Both are reported as schema errors, naming what to move:

```
An object can be in one language, so it can have one locale field.
Found 'locale', 'language'.

Everything here is already in one language, so 'byLanguage' cannot set
another. Move the locale-keyed record out of this object, or take the outer
one away.
```

A scope three levels deep is reported once, by the scope immediately enclosing
it, rather than by every ancestor.

The rule is **validated rather than typed**. Expressing "no scope below this
one" as a type constraint means threading it through every schema class's type
parameter, and the errors a recursive constraint like that produces name the
whole tree — an unrelated typo in a `.val.ts` would print pages.

`localeAt(path, snapshot)` (from `@valbuild/shared/internal`) answers which
language governs a path, and is the one implementation of that question, so the
Studio, the server and the validation worker cannot disagree. It returns the
**canonical tag** rather than the stored spelling: with
`.aliases({ "nb-NO": "no" })` a key reads `no` and `localeAt` says `nb-NO`,
which is what `<html lang>`, `Intl` and `locales.available` all want.

It answers `null` where no scope governs the path, where the project has
declared no languages, and where a locale field holds something that is not one
of them — validation is already reporting the last, and guessing would put a
language in `<html lang>` that nobody chose.
