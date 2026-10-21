---
"@valbuild/ui": patch
"@valbuild/shared": patch
---

Picking a language in the Studio now scopes the whole Studio to it.

- The Pages tree, the Data list, lists inside a field and search show only content in that language, plus content in no language (settings, authors, images), which every language shares. A page is in a language when its route names it (`s.router(router, { locale: … }, item)`) or its content has an `s.locale()` field.
- Picking a language while you are on something in another one moves you: to the same entry in the new language where Val knows it (a record keyed by `s.locale()`, or a route that differs only in its language segment), otherwise to the nearest parent that is not in another language, otherwise to the Studio's start screen with nothing selected.
- A link or a reference to something in another language still opens it, and that one item is listed while you are on it.
- Publish, Discard all and the error count are not filtered: they act on every language.
