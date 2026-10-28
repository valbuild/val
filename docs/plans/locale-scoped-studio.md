# Picking a language scopes the whole Studio

> **Status: built, first round** (valbuild/val#940). Sections 2, 3 and 5's
> "never hide anything", and the Pages tree, Data list, field lists, canvas and
> search rows of section 4, are what the Studio does. **Not built yet:** the
> pickers and new-page rows of section 4, and the hidden-by-filter label in
> section 5. It replaced one rule the code used to state — "the filter changes
> what is LISTED, never what is reachable" — with the invariant in section 3.

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
> language, except one the editor opened directly.**

A location is where the editor is: the selected source path, and the route on
the canvas. There are two ways to end up on a location in another language, and
each has its own answer:

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
3. **Otherwise, to the Studio's start**, with nothing selected (the "Pick
   something to edit" screen, `VAL_HOME_ROUTE`). This is the case when the
   nearest visible ancestor is a router (a list of pages, not a page) or
   nothing at all (a module whose root opens a scope in another language).

   **Not a page, not even `/`.** An earlier draft sent the editor to L's home
   page, and that has no safe answer: the site's `/` can itself be in the
   language just left, and "the shortest route in L" is a guess about how a
   site is laid out. The start screen is in no language.

The canvas follows the selection, so it goes where the editor goes, and with
nothing selected it falls back to a route the filter still lists.

The move is a navigation (`push`): the entry before it still carries the old
language in its URL, so Back undoes both together.

### 3b. Opened directly: shown, and listed on its own

Once every list is filtered (section 4), the only ways to reach a location in
another language are the ones that name it directly:

- a link to it
- "go to" on a reference
- an entry in the errors list or in the publish review (section 5)
- Back and Forward

For these, **the location opens and the filter stays.** The editor asked for
that exact item, so they see it. While they are on it, **that item, and no other
item in its language, is listed in the menu** too: the Pages tree shows that one
page, and the list it is a row of shows that one row. That way the menu still
says where they are. As soon as they navigate somewhere else, it leaves the
menu again.

Everything the menus offer is still filtered, so ordinary navigation can never
take an editor to a page in another language. Only the item they opened
directly is the exception, and only while they are on it.

So the invariant is really: **nothing in another language is shown, except the
one location the editor opened directly.**

## 4. What each surface does

The rule for every surface: run the same predicate over everything it lists.
After that, any group left empty is hidden too.

| Surface                            | Under L                                                                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pages tree                         | Routes in another language are gone, and folders left empty go with them (`/nb/…` disappears under English)                                                                |
| Explorer                           | Modules whose root opens a scope in another language are gone. Lists inside a module filter as they do now                                                                 |
| Fields (records, arrays, blocks)   | As built today (`LocaleFiltered`, `useLocaleFilterPredicate`), extended to router keys                                                                                     |
| Canvas route bar and fallback      | Only L's routes and routes in no language                                                                                                                                  |
| Search                             | Hits whose `localeAt` is another language are dropped                                                                                                                      |
| keyOf, route and reference pickers | NOT BUILT. Offer only options in L or in no language. A value already set to another language is still SHOWN as the value: it is content, and hiding it would misreport it |
| New page / new entry               | NOT BUILT for routes. A locale route parameter starts at L (`useEmptyOf` already does this for locale fields)                                                              |
| Media, Settings                    | Unchanged. They are in no language                                                                                                                                         |
| Headings, breadcrumbs              | Unchanged. The invariant means they can only name a location in L                                                                                                          |

The last row of the pickers entry is the one place "not see anything" gives way:
showing a stored value as something else would be a lie about the content.

## 5. The exception: anything that acts on the whole project

Publish, Discard all, and the error count that blocks a publish act on every
language at once. **They must not hide anything.** Hiding the English change
you are about to publish from an editor working in Norwegian turns a view
filter into a way to ship things nobody looked at.

These surfaces show everything, and that much is built. Not built yet: grouping
whatever the filter would have hidden under a label such as "2 changes in
English, hidden by the language filter", with a button that switches to
English. Opening one of those changes is a 3b navigation: it opens, and the
filter stays.

## 6. One implementation

- **One rule: `isListedUnder(filter, itemLocale, location, path)`**
  (`ui/spa/utils/isAtLocation.ts`). The Pages tree, the Data list, the field
  lists and search all ask it, so none of them compares locale strings itself.
  What language an item is in comes from `localeAt`'s per-module form,
  `localeScopeAt`, or for a list row from `localeScopeOf` in
  `LocaleFilterProvider.tsx`, which gets the router case through
  `localeOfRouteKey`.
- **The schema decides what needs reading.** A route key or a record key
  answers from the path alone. Only a locale FIELD needs source. Pages and data
  modules are given their language in `useShellData`, which already recomputes
  on every source change (the nav reads sources with `useShallowModulesAtPaths`,
  which does), and reads nothing for a project with no languages declared.
- **One owner of the invariant.** `ValShell` owns `locale`. `changeLocale` there
  applies 3a when a language is picked: it moves the selected path
  (`relocateForLocale`, a pure function beside `localeAt` in `@valbuild/shared`,
  unit-tested there) and clears a route typed into the canvas bar when that
  route is in another language. The 3b exception is the current path, handed
  to the menus as the one location they keep.
- **The comments that state the old rule change with it**, in
  `LocaleFilter.tsx`, `LocaleFilterProvider.tsx` and `useShellUrlState.ts`
  ("never what is reachable").

## 7. Tests

The unit tests sit next to `localeAt.test.ts`:

- `localeRelocation.test.ts`: the counterpart, the nearest visible ancestor and
  the start screen, for a record key, a route, a field and a module root
- `localePages.test.ts`: the filtered page tree, the current page kept, and
  rows reused where nothing changed

The end-to-end tests run in `examples/tanstack`, which has all three openers,
in the `tanstack` project:

1. With Norsk picked, the Pages tree lists `/nb/news/val-pa-norsk` and not
   `/news/val-in-english`. `translated.val.ts` lists the `nb-NO` announcement
   and the Norwegian post only.
2. Open `/news/val-in-english`, then pick Norsk. The Studio goes to its start
   screen with nothing selected (section 3a, step 3: there is no counterpart for
   a different slug).
3. On `announcements."en-US"`, pick Norsk. The location becomes
   `announcements."nb-NO"`, which is the empty entry.
4. Open a link to the English page with `?locale=nb-NO`. The page opens, the
   filter still reads Norsk, and the Pages tree lists that English page and no
   other English one. Navigate to another page, and it leaves the tree.
5. Not built yet: with Norsk picked and an English change pending, the publish
   review still lists that change, under the hidden-by-filter label.

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

3. **Opening something in another language directly shows it**, with the filter
   unchanged, and lists that one item in the menu while the editor is on it
   (3b). Ordinary navigation never leads to another language.
4. **The counterpart first** (3a.1), where Val knows it for certain, then the
   parent, then the Studio's start with nothing selected, never a page.
