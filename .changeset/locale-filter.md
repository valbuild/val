---
"@valbuild/ui": minor
---

A locale filter in the Studio: work through one language at a time.

Pick a language from the filter in the top bar — the bottom bar on a phone — and
the Studio shows that language's content. **Content in no language at all is
always shown**, which in most projects is most of it: the filter narrows a
translated section rather than emptying the Studio.

It changes what is **listed**, never what is reachable. A link to a Norwegian
page opens that page while the filter says English, because the filter is for
working through one language and not a permission on the content.

The default is all locales, and it is deep-linked as `?locale=nb-NO`, so a link
carries the view you are on. A project that has declared no languages has no
filter at all: a picker offering only "All locales" is furniture that explains
nothing.

Filtering is a per-node question rather than a walk, and that falls out of the
scope rule: only a node that OPENS a locale scope is ever filtered, and content
inside a scope is reachable only through the node that opened it — so hiding
that node takes its subtree with it. Two of the three ways a scope opens are
answerable from what a list already has: an entry of a locale-keyed record (the
key IS the language, aliases resolved, so a `/no/…` key is Norwegian) and an
object with a `locale` field.

The filter reaches record entries, array items and blocks. A locale-keyed record
filters its KEYS, so a row in another language is never rendered at all; every
other row asks its own content, because a list has paths and the language is in
the row.

A locale field nobody has filled in stays listed. Hiding it would hide the field
someone has to fill in to un-hide it — and a row that has not loaded yet stays
listed too, so a list does not shed rows as it arrives.

Not yet filtered: the Pages and Data panels. A page is a tree rather than a list,
so hiding one is a different question from hiding a row, and it is worth its own
change.
