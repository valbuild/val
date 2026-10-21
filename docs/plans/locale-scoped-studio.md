# Picking a language scopes the whole Studio

> **Status: proposed.** Nothing here is built yet beyond what section 1 lists
> as already there. It replaces one rule the code states today — "the filter
> changes what is LISTED, never what is reachable" (`LocaleFilter.tsx`,
> `useShellUrlState.ts`) — with the invariant in section 3.

The ask: when an editor picks one language in the Studio's locale picker, they
see that language and nothing in any other. Routes in another language leave the
Pages tree. Entries in another language leave every list. And if the page or
field they are on is in another language, the Studio moves them off it.

This should be one general rule, not special cases per surface. This document
works it out from what Val already knows about language, so that every surface
gets its answer from the same place.

## 1. What Val already knows

A **locale scope** is a subtree of content in one language. Exactly three
things open one, all declared in the schema:

| Opener                         | Example                                         | Where the language is read from |
| ------------------------------ | ----------------------------------------------- | ------------------------------- |
| A locale field on an object    | `s.object({ locale: s.locale(), … })`           | the field's value (source)      |
| A locale-keyed record          | `s.record(s.locale(), item)`                    | the key (path)                  |
| A locale parameter in a router | `s.router(router, { locale: urlLocale }, item)` | the route key (path)            |

`.locales()` on an `s.enum` makes the enum a locale, so `nb` can mean `nb-NO`
and `{ null: "en-US" }` can say which language a URL without the segment is in.

Two facts make the rest of this document possible:

1. **Scopes do not nest** (`localeScopeErrors`). A path passes at most one
   opener, so "what language is this path in" has at most one answer.
2. **That answer has one implementation:** `localeAt(path, snapshot)` in
   `@valbuild/shared`. It returns one of the project's languages, or `null` when
   no scope covers the path.

`examples/tanstack` has all three openers: `translated.val.ts` (a record and a
field) and `_site.{-$locale}.news.$slug.val.ts` (a route parameter). The demo in
valbuild/home has no languages yet, so section 8 lists what to add to it.

What is built today: `LocaleFilterProvider` and `useLocaleFilterPredicate` hide
**rows inside a field** (record entries and array or block rows) whose scope is
in another language. Nothing above the field level is filtered:

- the Pages tree (router keys are skipped on purpose, with a comment saying so)
- the Explorer
- search
- the canvas route bar and its fallback route
- the reference and route pickers

The current path is also never moved.

## 2. Three answers, not two

With language **L** selected, every path is one of:

- **in L:** `localeAt(path) === L`. Shown.
- **in another language:** `localeAt(path)` is some other language. **Hidden,
  everywhere.**
- **in no language:** `localeAt(path) === null`. Shown.

The third case is a decision, and the one most likely to be challenged by "they
should not see anything that is not in that locale". Content in no language is
not content in another language. It is what every language shares: settings,
authors, the image gallery, the site's colours. Hiding it would leave a
Norwegian editor unable to change the photo on the Norwegian page.

What it must NOT mean is guessing. A page that is really Norwegian, but sits in a
router with no locale parameter, is in no language as far as Val can tell. It
stays visible under every filter. **The fix for that is in the schema** (give
the router a locale parameter, or the object a locale field). It is never a
heuristic that reads `/nb/` out of a URL the schema does not describe. A
language Val guesses is a language nobody chose. It ends up in `<html lang>`,
and it hides a page with no way to see why.

Two edge cases follow from the same rule and are already how `localeAt` and
`LocaleFiltered` behave:

- **A locale field that is not filled in** is in no language, so it stays
  visible. Hiding it would hide the field someone has to fill in.
- **A declared but unwritten translation** (`"nb-NO": null` in a locale-keyed
  record) is in L, so it is shown, as an empty entry. That gap is the whole
  reason to filter by language.

So the visibility rule is a single predicate:

```ts
visibleUnder(L, path) =
  L === null || localeAt(path) === null || localeAt(path) === L;
```

Because scopes do not nest, the scope check only has to run on the node that
OPENS the scope. Everything below a hidden node goes with it. That is what keeps
the predicate cheap per row (see section 6).

## 3. The invariant

> **While a language is selected, the Studio never shows a location in another
> language.**

A location is where the editor is: the selected source path, and the route on
the canvas. A location can break the invariant in two ways, and each way has its
own fix:

### 3a. The filter changes and the location is wrong: the location moves

This is the case in the ask. The editor is on `/news/val-in-english` and picks
Norsk. Move the location, in this order of preference:

1. **To its counterpart in L, where Val KNOWS the counterpart.** Val knows it
   in two cases:
   - **A locale-keyed record.** Swap the key:
     `announcements."en-US".title` → `announcements."nb-NO".title`. That entry
     always exists, possibly as `null`, and an empty entry is exactly what this
     editor came to fill in.
   - **A route whose only difference is the locale parameter.** For example,
     `/about` → `/nb/about`. This applies only if that route exists, and is
     never created.
2. **Otherwise, to the nearest ancestor that is visible under L.** For example,
   `posts.1.title` (an English post) → `posts`. The list is still there,
   filtered to Norwegian.
3. **Otherwise, to L's root.** This is the case when the nearest visible
   ancestor is a router (a list of pages, not a page) or nothing at all (a
   module whose root opens a scope in another language).

   **L's root** is L's home page: the shortest route `localeAt` puts in L
   (`/nb`, or `/` when `{ null: "en-US" }` and L is `en-US`), chosen as
   `canvasFallbackRoute` chooses, but over L's routes only. If L has no routes,
   it is the Studio's start with no page selected.

The canvas route moves by the same rule: a route in another language goes to its
counterpart, or to L's root.

Use `replace`, not `push`, for the history entry. The move is part of the filter
change, and Back should undo both together.

### 3b. The location changes and the filter is wrong: the filter moves

Once every list is filtered (section 4), the only ways to reach a location in
another language are the ones that name it directly:

- a link with `?locale=` set
- a click on an element in the canvas
- "go to" on a reference
- an entry in the errors list or in the publish review (section 5)
- Back and Forward

For these, **switch the filter to the location's language** instead of bouncing
the editor to a root. They asked for that exact thing, and sending them
somewhere else is a dead end with no explanation. Tell them in one line, with
the way back: "Showing Norsk, because this page is in Norwegian." with a
**Show English** button. That button applies 3a.

A link whose `?locale=` disagrees with its own path contradicts itself. The path
wins: it is what was linked to, and the locale is view state copied along with
it.

Only these two rules keep the invariant without either side surprising the
editor: whichever side the editor changed last wins, and the other side
follows.

## 4. What each surface does

The rule for every surface: run the same predicate over everything it lists.
After that, any group left empty is hidden too.

| Surface                            | Under L                                                                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pages tree                         | Routes in another language are gone, and folders left empty go with them (`/nb/…` disappears under English)                                                     |
| Explorer                           | Modules whose root opens a scope in another language are gone. Lists inside a module filter as they do now                                                      |
| Fields (records, arrays, blocks)   | As built today (`LocaleFiltered`, `useLocaleFilterPredicate`), extended to router keys                                                                          |
| Canvas route bar and fallback      | Only L's routes and routes in no language. The fallback is L's root (3a)                                                                                        |
| Search                             | Hits whose `localeAt` is another language are dropped                                                                                                           |
| keyOf, route and reference pickers | Offer only options in L or in no language. A value already set to another language is still SHOWN as the value: it is content, and hiding it would misreport it |
| New page / new entry               | A locale route parameter or a locale field starts at L (`useEmptyOf` already does this for fields)                                                              |
| Media, Settings                    | Unchanged. They are in no language                                                                                                                              |
| Headings, breadcrumbs              | Unchanged. The invariant means they can only name a location in L                                                                                               |

The last row of the pickers entry is the one place "not see anything" gives way:
showing a stored value as something else would be a lie about the content.

## 5. The exception: anything that acts on the whole project

Publish, Discard all, and the error count that blocks a publish act on every
language at once. **They must not hide anything.** Hiding the English change
you are about to publish from an editor working in Norwegian turns a view
filter into a way to ship things nobody looked at.

These surfaces show everything. They group whatever the filter would have hidden
under a label such as "2 changes in English, hidden by the language filter",
with a button that switches to English. Opening one of those changes is a 3b
navigation.

## 6. One implementation

- **One predicate: `visibleUnder(L, path)`, built on `localeAt`.** It is not a
  second walk over the content, and nothing in the UI compares locale strings.
  `localeScopeOf` in `LocaleFilterProvider.tsx` gets the router case through
  `localeOfRouteKey` (exported from `localeAt.ts`). A row then has to carry its
  module file path and its parent router's schema. That is the gap behind "a
  router's pages are not filtered".
- **The schema decides what needs reading.** A route key or a record key
  answers from the path alone, with no source read, so the Pages tree filters
  for free. Only a locale FIELD needs source. A module whose schema has no
  locale opener anywhere can never be hidden, so it is never read for this. A
  module whose root object has a locale field is read with one listener per
  module, as `usePreviewDemand` does for previews, never one per row.
- **One owner of the invariant.** `ValShell` already owns `locale`. One effect
  there takes the current path and canvas route and applies 3a when `locale`
  changes and 3b when the location changes. The counterpart lookup (3a.1) is a
  pure function of the path and the snapshot, beside `localeAt` in
  `@valbuild/shared`, and it is unit-tested there.
- **The comments that state the old rule change with it**, in
  `LocaleFilter.tsx`, `LocaleFilterProvider.tsx` and `useShellUrlState.ts`
  ("never what is reachable").

## 7. Tests

The unit tests sit next to `localeAt.test.ts`:

- `visibleUnder` for each of the three answers and each of the three openers
- the counterpart and the nearest visible ancestor for a record key, a route, a
  field and a module root
- L's root when a `{ null }` locale owns `/`

The end-to-end tests run in `examples/tanstack`, which has all three openers,
in the `tanstack` project:

1. With Norsk picked, the Pages tree lists `/nb/news/val-pa-norsk` and not
   `/news/val-in-english`. `translated.val.ts` lists the `nb-NO` announcement
   and the Norwegian post only.
2. Open `/news/val-in-english`, then pick Norsk. The location becomes Norsk's
   root (section 3a, step 3: there is no counterpart for a different slug), and
   the canvas follows.
3. On `announcements."en-US"`, pick Norsk. The location becomes
   `announcements."nb-NO"`, which is the empty entry.
4. Open a link to the English page with `?locale=nb-NO`. The page opens, and the
   filter reads English with the notice.
5. With Norsk picked and an English change pending, the publish review still
   lists that change, under the hidden-by-filter label.

## 8. The demo

`demo/` in valbuild/home declares no languages today, so the picker does not
appear there. To make it the example of this feature, it needs:

- `locales.available` in its settings
- one router with a `{-$locale}` segment (the journal is the natural one), with
  an English and a Norwegian entry
- one locale-keyed record in `site.val.ts`

Its end-to-end tests would repeat 1–4 above. That work goes in home, after the
release that carries this one (see "Demo mode" in `.claude/CLAUDE.md`).

## 9. Decisions

Confirmed:

1. **Content in no language stays visible under every filter** (section 2). The
   alternative, a strict mode that hides it, makes shared content uneditable
   while a filter is on.
2. **Whole-project actions are never filtered** (section 5).

Still to confirm:

3. **Navigating to another language switches the filter**, instead of sending
   the editor to a root (3b). Root is where a FILTER change sends you. It is not
   where a click sends you.
4. **The counterpart before the root** (3a.1), where Val knows it for certain.
