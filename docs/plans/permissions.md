# Roles and permissions

> **Status: plan.** Nothing below is implemented yet. Locale scope additionally
> depends on #608 landing.

Who may do what in the Studio, declared as data in the settings module.

## What this is for, and what it is not

**This is a conscience mechanism, not a security boundary.** It exists so that
an editor finds it harder to do something they were not meant to do — change the
wrong page, type into the wrong locale, publish a section that is not theirs.
It is not a defence against someone who wants to get past it.

Everything below is enforced in the Studio only. No source is redacted on the
way to the browser, and no patch is rejected on the way back. Anyone who can
reach the Studio can already reach `PUT /patches`, and `examples/next/val.modules.ts`
has said as much about `hidden()` and `readonly()` since before any of this.

Three consequences follow, and they are the reason the framing is stated first:

1. **Nothing may be named as though it were security.** `hidden` and `readonly`
   describe presentation and both stay honest. Nothing gets called `secret`,
   `private`, `confidential` or `denied` — and the settings section is `access`,
   not `permissions`, for the same reason: it is the most visible name in the
   design, it is what the Studio panel is called, and "permissions" reads as a
   promise this does not make. The word survives for the unit inside it — a
   permission to take an action — where it is accurate.
2. **The staged-content rule below would be a bug in a security model.** It is
   correct here. If this ever becomes a real boundary, that rule is the first
   thing to revisit.
3. **The messages are explanatory, not refusals.** "This page is in French, and
   you work on Norwegian" — not "Forbidden".

## Vocabulary

Three words that get used interchangeably and should not be.

|                | Answers                 | Attached to           |
| -------------- | ----------------------- | --------------------- |
| **Permission** | May this action happen? | a role                |
| **Role**       | Who is this person?     | a member              |
| **Scope**      | Over which content?     | a member's assignment |

A permission is the unit that gets **checked**. A role is the unit that gets
**assigned** — a named bundle, so an admin assigns two things instead of forty
and a policy change is one edit. Scope is the extent: which locales, and later
which modules.

The OAuth sense of "scope" — the subset of a person's authority delegated to a
token — is deliberately not used. It is the right word for MCP access tokens if
they ever carry a subset, and this codebase has already spent it on extent
(`PreviewScope`), which is the sense used here.

**Schemas name permissions. Never roles, never emails.** A schema annotation is
code, reviewed and deployed; a role membership is data edited in the Studio on a
Friday afternoon. Putting a role name in a `.val.ts` means renaming a role in a
UI silently changes what a content file means.

## The settings section

```ts
export default c.define("/settings.val.ts", s.settings(), {
  access: {
    roles: {
      editor: ["content:write", "assistant:use"],
      publisher: ["content:write", "publish"],
      translator: ["content:write", "assistant:use"],
      admin: ["settings:read", "settings:write"],
    },
    members: {
      usr_7f3a91: ["publisher", "admin"],
      "ola@company.com": {
        roles: ["translator"],
        locales: { "en-US": "read", "nb-NO": "write", "fr-FR": null },
      },
    },
    default: ["editor"],
  },
});
```

- `roles` — a record of role name to permission strings. A bare array: a role
  needs no other fields, and the Studio derives its label from the key with
  `fixCapitalization`, the way it already does elsewhere.
- `members` — keyed by profile id or email. A bare array of role names for the
  common case, or an object when the assignment carries scope.
- `default` — roles every user gets, **union**ed with whatever their own entry
  grants. Not a fallback for unlisted users: listing someone must never take
  something away, or `members: { boss: ["publisher"] }` over
  `default: ["editor"]` silently means the boss cannot edit.

A record rather than a list of `{ email, roles }` objects for three reasons:
each member is a stable patch path, so two admins editing different people do
not collide and the review view names the person rather than `members[2]`;
duplicates cannot be expressed; and it is the same shape as `roles`.

### Roles are flat sets

A role grants exactly the permissions it lists. Roles do not nest, rank or
inherit: `publisher` is not "editor plus more", and an `admin` without
`content:write` cannot edit content. Holding several roles is the union of them,
with no tiebreak, because there is nothing to break a tie between.

A hierarchy has to place every permission on one ladder, and permissions a
project invents are rarely on one — `finance` is neither above nor below
`publisher`, it is a different job. It would also hand out permissions by rank
rather than by intent: the publisher of the pricing page would get
`pricing:edit` for being senior, which is exactly the accident this exists to
prevent.

The cost is repetition, and `default` is what pays it: **put the baseline in
`default`, and write each role as the short list of what it adds.**

```ts
roles: {
  editor: ["content:write", "assistant:use"],
  publisher: ["publish"],
  finance: ["pricing:edit"],
},
default: ["editor"],
```

There is deliberately no `"*"`. A wildcard would silently include permissions
invented later, which defeats naming them.

### Prefer profile ids over emails

**A member key may be a profile id or an email, and the Studio writes ids.**

The settings module is content, and content reaches the browser: `val.modules.ts`
registers each module as `{ def: () => import("./x.val") }`, and
`ValModulesClient` — a `"use client"` component in the root layout — puts that
registry on `window.__VAL_MODULES__`. The closures are in the initial bundle;
the module bodies are separate chunks fetched when the Studio opens. So a member
list is not page weight, but it IS an unauthenticated static asset, and it is in
git besides. A list of employee email addresses does not belong there.

There is no way around shipping it: the Access panel has to render the member
list in the browser, and under UI-only enforcement there is nothing to gate that
on. Ids make what ships harmless — opaque strings and role names.

The identifier already exists and is already resolved for display:

- `profileId`, typed `AuthorId` (`ValOps.ts:219`) — the same brand patches carry
  as `author`.
- `useCurrentAuthorId()` returns it for the current user (`ValProvider.tsx:2384`).
- `useProfilesByAuthorId()` maps it to a name and avatar from `/profiles`, which
  is how the review UI already names patch authors. `/profiles` is authenticated,
  so names never enter a chunk.

Emails stay legal because an id is unknowable until the person has logged in:
bootstrapping "give erik@ admin" in a hand-written `.val.ts` needs one. Two rules
follow — if a person matches both an id entry and an email entry the grants
**union**, and the Studio warns, since `/profiles` gives it the email for the id;
and an id that resolves to no profile is a warning, never an error, because
resolving it needs a network call the CLI may not be able to make.

**The Studio offers to convert an email entry, it never does it by itself.** When
the person behind `"erik@company.com"` has a profile, the Access panel shows the
row with their name and avatar, a note that it is stored by email, and a one-click
"store as profile id". Rewriting it automatically on first login would be a write
to the settings module that nobody asked for and that has no author — and it
could only be made as someone holding `settings:write` anyway. The cost is that
emails stay in the file until someone clicks.

**The people picker lists project members only.** Its list comes from
`/profiles`, which knows the people who have joined the project on val.build.
Everyone else is added by email. So email entries are not only a bootstrapping
step: they are how anyone who has not yet joined gets access, and a real project
will always have a few.

### Built-in permissions

```ts
export type ValPermission =
  | "content:write" // PUT /patches, POST /upload/patches, patch groups
  | "publish" // POST /save
  | "settings:read" // the Settings section appears at all
  | "settings:write" // its fields are editable
  | "assistant:use"; // POST /ai/* — costs money, sends content to a model

/** A permission: one of Val's, or one a project invented for its schemas. */
export type Permission = ValPermission | (string & {});
```

Deliberately coarse. These say whether an action may happen at all; which
_fields_ are involved is the schema's business.

`publish` carries no resource prefix because it does not act on a resource: one
commit ships content and settings together, so a `settings:publish` cannot
exist.

### Implications

**Val defines implications among its own built-ins, and never among project
permissions.**

- `settings:write` implies `settings:read`. A role with only `settings:write`
  would have editable fields in a panel that is not in its nav.
- `content:write` or `publish` gives the discard controls (below).

There is no `content:read`. Reading content is not gated by any permission —
only narrowed, by `hidden` and by locale scope — so it would gate nothing the
session does not, and `publish` would have to imply it as well, which leaves it
distinguishing a viewer from `[]` and nothing else.

`seo:edit` implying `seo:read` is the developer's to say, in the schema (see the
schema API). Val knows what its own permissions mean; it does not know what a
project's mean.

### Discarding is not a permission

`DELETE /patches` has no permission of its own. **The discard controls appear if
you have `content:write` or `publish`** — write, because adding to the pending
queue and taking your own contribution back out are one capability; publish,
because reviewing means being able to reject as well as ship.

It was a sixth permission for a while, on the grounds that discard reaches other
people's unpublished work. Splitting it out creates a worse state than the one it
guards against. A role of `["content:write"]` alone is an editor who can make
pending changes and cannot undo them: the queue is theirs to fill and nobody's to
empty, and "edit the value back" leaves the junk patch in it. Worse, an invalid
patch blocks publish for the whole project and the remedy Val offers is to
discard it — `PatchErrorsDialog` has no other button (`PatchErrorsDialog.tsx:142`).
So the editor who most needs discard is the one who just made a mistake, and that
is precisely who the split disarmed.

If a project ever genuinely wants "may draft, may not withdraw", that is a review
workflow — drafts that need approval to retract — and not something a permission
flag can express honestly.

Not included, and each easy to add when someone asks: `content:read` (under
UI-only enforcement it would only mean "may open the Studio", which the session
already decides — and leaving it out makes a viewer role simply `[]`),
`history:read`, and draft-mode toggling.

## The schema API

```ts
s.object({
  title: s.string(),
  price: s.number().readonly({ unless: "pricing:edit" }),
  notes: s.string().hidden({ unless: ["hr:read", "finance:read"] }),
});
```

`unless` takes one permission or several; several means **any one is enough**.

**Val makes no inference between permission strings.** It does not know that
`seo:edit` implies `seo:read` — the names are the project's, and the `:` in them
is a convention, not a syntax Val reads. Where seeing and changing need different
audiences, the schema says so in both places:

```ts
s.object({ canonical: s.string(), noindex: s.boolean() })
  .hidden({ unless: ["seo:read", "seo:edit"] })
  .readonly({ unless: "seo:edit" });
```

Listing `seo:edit` in `hidden` as well is what makes "write includes read" true
for a permission the project invented. One permission for both is the common
case; split it only when there is a "can see, cannot change" audience.

The polarity is in the key rather than positional, because `hidden("editor")`
reads equally well as "hidden from editors" and "hidden from everyone except
editors", and picking wrong is silent.

There is deliberately no `when` / `hiddenFor` inverse. Deny-lists fail open — a
role invented later sees everything nobody thought to exclude it from — and
having both means every field's visibility is a set operation computed in the
reader's head.

Today's forms are untouched: `hidden()`, `hidden(false)`, `readonly()` all keep
their meaning.

**A restriction on an ancestor covers everything below it.** Walking from the
module root to a field, the field is hidden for you if it or any ancestor is
hidden for you, and read-only if it or any ancestor is read-only for you. A child
can add a restriction; it can never remove one. There is no way to surface
something from below.

```ts
s.object({
  canonical: s.string(),
  metaDescription: s.string().hidden(false), // still hidden: `seo` is
}).hidden({ unless: "seo:edit" });
```

A developer who wants part of a section visible restricts the fields, not the
section:

```ts
const seoOnly = { unless: "seo:edit" };

s.object({
  title: s.string(),
  body: s.richtext({}),
  seo: s.object({
    metaDescription: s.string().maxLength(160),
    canonical: s.string().nullable().hidden(seoOnly),
    noindex: s.boolean().hidden(seoOnly),
    structuredData: s.string().hidden(seoOnly),
  }),
});
```

**Access must not change the shape of the content.** Splitting `seo` into `seo`
and `seoAdvanced` would also work, but it moves `noindex` to a different path: every
page reading `page.seo.noindex` changes with it, and so does every existing
source, so adding a permission to an existing project would mean migrating
content. Annotating the fields leaves the data model exactly as it was. Split a
section only where the split is the natural shape anyway.

The cost is the inverse of the container form: a field added to `seo` later is
visible until someone annotates it, where a field added to a restricted container
is hidden from the start. A shared value like `seoOnly` keeps the annotations
from drifting apart, but it does not annotate the next field for you.

An object whose fields are all hidden for you is not drawn — an empty section is
noise, not information. That is presentation, not a rule about access: nothing
is shown that the schema hides.

Same for `readonly`: a locked section with one editable field is the locked
fields annotated, and the editable one left alone.

This is the simpler rule to hold in your head. Whether a field shows is decided by
reading up its path until something says no, and a restricted container means
what it looks like it means — nothing inside it can quietly opt out, so a reviewer
does not have to read every child to know what a `.hidden({ unless })` hides.

Chaining on one field is a different axis and keeps its meaning: each call
replaces the flag on the schema it returns, so `s.string().hidden().hidden(false)`
is visible. Last call wins on one field; any restricted ancestor wins down the
tree.

A `.hidden(false)` or `.readonly(false)` on a field whose ancestor is restricted
can never take effect. That is reported as a **warning** — it is dead, not
dangerous, and it almost always means the author expected the override this
rule does not have.

## Resolution

A user's effective permissions are the union of the permissions of every role
they hold. Their roles are `default` plus whatever their own `members` entry
grants — matched on profile id or email, and unioned when both match.

Two rules that override everything above:

- **No `access` section, or an empty one: every user has every
  permission.** Existing projects are unchanged, and an empty section is not a
  statement that nobody may do anything.
- **Local (`fs`) mode: every permission.** There is no identity to resolve, and
  the developer owns the filesystem.

### Staged content is always visible

**If a path has an unpublished patch, it is shown — whatever `hidden` or the
locale scope says.** The same applies up the ancestor chain: a hidden object
containing a patched field must be reachable, so a path is visible if it or any
descendant is patched.

This is the rule that would be indefensible in a security model and is right
here. Publishing is not locale-gated and discarding throws away other
people's work, so an editor can ship and can destroy changes they cannot
otherwise see. Being unable to look at what you are about to publish is exactly
the mistake this feature exists to prevent.

**What staging surfaces is read-only.** Showing a field so you can see what you
are about to ship does not make it yours: `hidden({ unless })` meant "not your
field", and it still does. You can look at it and you can discard it — which
anyone who may write or publish can do — but not type into it. A hidden
container is drawn only as far as it takes to reach the patched field inside it,
and read-only too.

It is marked, discreetly: a quiet note on the field saying it is showing because
of an unpublished change, not a banner. A field can appear, be published, and
disappear again, and without the note that reads like a bug.

This is the only place a hidden container is ever drawn. The schema has no way
to surface something from inside one (see the schema API); the staged-content
rule is not the schema's decision but the pending queue's.

### Permissions are read from the published source

Settings are content, so a user can patch the access section. Resolving
against the patched source would let someone unlock their own Studio from an
unpublished draft. `/sources` already takes `exclude_patches`.

One consequence to keep in mind for the guards below: an edit to the access
section does not take effect until it is published. An admin who removes their
own access keeps working until someone publishes, and finds out afterwards.

That is the intended behaviour, not a side effect: **access changes take effect
on publish**, like any other content. Someone granted a role sees no difference
until it ships, and every message about an access edit says "when published".

It follows that access changes go live when _someone_ publishes, not when the
admin who made them does. Publishing is not gated by `settings:write`, and
settings ship in the same commit as content, so a publisher without access to the
panel ships an admin's changes — seeing them read-only in the review, under the
staged-content rule. That is how it has to be while publish is one commit for
everything.

### Editing the access section: one refusal and one warning

Editing access is the one edit that can take away the ability to make the next
one. Two guards, and the line between them is the same one that decides
error from warning:

> **Refuse when nothing in the Studio can undo it. Warn when someone else can.**

**Refuse: an edit that leaves nobody with `settings:write`.** The Studio will not
write the patch — not a dialog to confirm through, a refusal that says which edit
would do it. The state is recoverable (edit the `.val.ts` by hand, or open the
project locally, where every permission is granted), so this is not about an
unrecoverable project. It is about not turning an admin's afternoon into an
errand for a developer.

Computing "nobody" has three parts that are easy to get wrong:

- Resolve against the source **as the patch would leave it**, not as it is.
- `default` counts. If `default` grants `settings:write` then everyone has it and
  no member edit can be the last one — and conversely, **editing `default` is the
  dangerous edit**, because one field can remove it from everybody at once. A
  guard that only watches `members` misses the case that matters most.
- Union id and email entries first, so one person listed both ways counts once
  and removing one of their two entries is not read as removing the last admin.

The Studio is not the only way in, so the same condition is also a validation
**error** — that is the backstop for a hand-edited `.val.ts`, and it belongs on
the error side of the severity rule: it is contained in the settings module, and
whoever is looking at it can fix it.

**Warn: an edit that lowers your own permissions.** Diff your own effective set
before and after; if the edit would take anything away, say what. Losing your own
`settings:write` is the case worth naming in the message, but it is a warning
rather than a refusal for exactly one reason — another admin can put it back.

Deliberately not a refusal: stepping down from admin is a legitimate thing to do,
and the mistake it guards against is doing it by accident while editing a role
that happens to be yours.

## Locale scope

Depends on #608, which introduces the concept this reuses:

> A locale scope is a subtree governed by one locale. … `localeAt(path, snapshot)`
> is the one function that answers which locale governs a path, so the Studio,
> the server and the validation worker cannot disagree.

A locale-scoped check is therefore `localeAt(path)` compared against the
member's granted locales. No new resolver, and the three implementations cannot
drift.

```ts
usr_ola: {
  locales: { "en-US": "read", "nb-NO": "write", "fr-FR": null },
}
```

`locales` is a record keyed by locale, one **level** per language: `"write"`,
`"read"`, or `null` for neither. It is the same shape as `assistant.translation`
in the same settings module, and it reads the way the Access panel will show it —
each language, and what this person does in it.

A translator who cannot see the source language cannot translate, so Ola reads
English in order to write Norwegian. **Write includes read** by construction: a
language has one level, and `"write"` is the higher one, so there is nothing for a
write to contradict.

The level is a limit, not a grant. `"write"` means "where your `content:write`
applies" — it gives nothing to someone who holds no `content:write` from their
roles or `default`. That is why the values are levels rather than permission
lists: `"nb-NO": ["content:write"]` would read as a grant, would bring back a
`content:read` that exists nowhere else, and would make `"nb-NO": ["publish"]`
valid syntax for scoping something that is never scoped.

**The record is complete**, under #608's rule for any record with a declared key
set: every language in `locales.available` is present, and `null` means no
access. Adding a language to the project is therefore safe by default — #608's
`record:fill-keys` fix writes `"de-DE": null` into every scoped member, so nobody
quietly gains or loses anything, and the new language appears on each row as a
decision to make. The cost is that every scoped member lists every language; the
fix writes them, so nobody types them.

`roles` is optional in the object form. A member who is a translator by virtue of
`default` alone is just their `locales`.

**Locale scope narrows exactly one thing: where you can type.** `content:write`
is checked against it; `publish`, `settings:read`,
`settings:write` and `assistant:use` are not, and none of them ever will be by
this mechanism. That is worth stating as a rule rather than leaving as an
accident of which cases came up, because it is what keeps the model small: a
member has a permission set and, separately, a level per language, and only
one permission consults them.

It also closes a question that looked open. Scope hangs off the member's entry
and so covers every role in it at once, which cannot say "Norwegian editor, and
also a global reviewer" — but since `content:write` is the only scoped
permission, the only configuration that needs per-role scope is one person
holding `content:write` at two different extents, and there the wider grant
simply subsumes the narrower. Member-level scope is enough.

### Discard is never locale-scoped

Every user sees every pending change, and anyone who may write or publish can
discard any of them, whatever their locales. This is deliberate, and it is not a
compromise:

- **A user legitimately holds patches outside their own locales.** Patches
  arrive in the same patch set as ones they did make; a settings change can
  narrow someone's locales after the fact. Their own queue would then contain
  work they could not clear.
- **Scoping it can orphan a patch.** A patch is deleted whole — `deletePatches`
  has no partial mode — so a patch spanning two locales needs someone who covers
  both, and a patch in a locale nobody currently holds could be discardable by
  nobody at all. A pending queue that cannot be emptied is a worse failure than
  an accidental discard.
- **Aggregate discards would have to lie.** "Discard all" and the per-module
  button cover patches in several locales at once. Scoped, they would silently
  mean "discard some", and the count on the button reached in a hurry is the
  last place to be approximate.

The accident this leaves open — discarding a colleague's work in a language you
do not work on — is handled where it belongs, at the moment of the action rather
than in settings: the confirm already names whose work would go
(`discardAuthorNames`, `ValShell.tsx:222`). That is the conscience mechanism
working at the right layer.

**Nothing anywhere grants a write without the matching read.** For locales that
holds by construction, since `"write"` is a level above `"read"`; for project
permissions the schema says it, by listing the write permission in `hidden`.

Defaults:

- `locales` absent — every locale, read and write. The member is unscoped.
- A language at `null` — not listed for this member at all.
- Content outside any locale scope — shared images, non-localized fields — is
  **readable and not writable** by a locale-scoped member. This is the
  translator semantic and the safe default; it may prove too strict for someone
  who works in two of three languages.

**Publish is not locale-gated.** One commit ships the whole pending set, and
splitting that is a bigger change than this is worth. The consequence is that a
Norwegian translator can publish English changes they cannot write — so the
publish confirm should say which locales are in the set, the way the discard
confirm already names whose work it would throw away.

Viewing within the readable set stays a user preference: #608's locale filter is
a filter, not a permission, and a deep link to a readable locale still opens it.
A link to a locale the member cannot read explains itself rather than 404ing.

## Validation

The universe of valid permissions is **every permission referenced by a schema,
plus the built-ins**. There is no separate registry: a permission exists because
something checks it.

The check cannot live in `executeValidate` — the Studio validates one module at a
time against a deserialized schema on a worker thread, so the settings schema
never sees the other modules. It goes where `resolveSettingsModule` already
lives: a pure function in `@valbuild/core` over the whole schema map, called by
the Studio with `schemas.data` (as `useNavMenuData.ts` does) and by the server
from `validateSources(schemas, sources)`. One implementation, so the CLI and the
Studio cannot disagree.

### Which severity, and why it splits that way

Validation errors block publish, so severity is a question about **who can
clear the block**, not about how wrong the configuration is.

> An inconsistency **inside** the settings module is an error: whoever is
> looking at it can fix it, there and then. An inconsistency **between settings
> and code** is a warning: the person who broke it is not the person who can fix
> it, and blocking publish punishes the whole project for it.

Errors — self-contained, fixable in the file being edited:

- A member references a role that `roles` does not define.
- A member's `locales` names a language not in `locales.available`, or a level
  other than `"read"`, `"write"` or `null`. (A language missing from it is the
  completeness error #608 already reports, with `record:fill-keys` as the fix.)

Warnings — one half of the statement lives in code:

- A role grants a permission nothing declares → _"`hr:raed` is not a permission.
  No schema requires it and it is not one of Val's own. Did you mean
  `hr:read`?"_
- A schema requires a permission no role grants → the field is restricted for
  everyone. A legitimate intermediate state between the annotation shipping and
  an admin granting the role.
- A member id resolves to no profile — that needs a network call the CLI may not
  be able to make.

The second warning is the one that decides it. Consider a developer deleting the
one field carrying `.hidden({ unless: "hr:read" })`: the permission stops
existing, every role granting it becomes invalid, and as an error that would
**block publishing project-wide** until an admin edits the roles — because
someone removed a field. Meanwhile the dangling grant is harmless: it is
permission to do a thing nothing checks.

**Sequencing.** Warnings do not exist yet — `docs/plans/validation-warnings.md`
is a plan. So either that lands first, or these ship Studio-only as non-blocking
hints on the offending row. What must not happen is shipping them as errors in
the meantime.

## Worked examples

All proposed API. Locale examples assume #608.

### Settings

Two tiers — everyone edits, one person ships:

```ts
access: {
  roles: {
    editor: ["content:write", "assistant:use"],
    publisher: ["content:write", "publish", "assistant:use"],
  },
  members: { usr_7f3a91: ["publisher"] },
  default: ["editor"],
}
```

A locked settings panel — only Erik sees Access at all:

```ts
access: {
  roles: {
    editor: ["content:write", "assistant:use"],
    publisher: ["publish"],
    admin: ["settings:read", "settings:write"],
  },
  members: { usr_a1: ["publisher"], usr_e2: ["publisher", "admin"] },
  default: ["editor"],
}
```

Agency and client — the client writes, the agency ships:

```ts
access: {
  roles: {
    "client-editor": ["content:write"],
    agency: ["content:write", "publish",
             "settings:read", "settings:write", "assistant:use"],
  },
  members: { usr_dev: ["agency"], usr_pm: ["agency"] },
  default: ["client-editor"],
}
```

Locale teams — the shape locale scope exists for:

```ts
access: {
  roles: {
    translator: ["content:write", "assistant:use"],
    lead: ["content:write", "publish"],
  },
  members: {
    usr_ola: {
      roles: ["translator"],
      locales: { "en-US": "read", "nb-NO": "write", "fr-FR": null },
    },
    usr_marie: {
      roles: ["translator"],
      locales: { "en-US": "read", "nb-NO": null, "fr-FR": "write" },
    },
    usr_sam: ["lead"],
  },
  default: [],
}
```

Restricted content, with permissions the project invented:

```ts
access: {
  roles: {
    editor: ["content:write"],
    hr: ["hr:read", "hr:write"],
    finance: ["salary:read"],
  },
  members: { usr_hrlead: ["hr"], usr_cfo: ["finance", "hr"] },
  default: ["editor"],
}
```

Bootstrapping, before anyone has logged in — email keys are for exactly this:

```ts
access: {
  roles: { admin: ["settings:read", "settings:write", "publish", "content:write"] },
  members: { "erik@company.com": ["admin"] },
  default: ["editor"],
}
```

A viewer is a role that grants nothing:

```ts
roles: { viewer: [], editor: ["content:write"] },
members: { usr_intern: ["viewer"] },
default: ["editor"],
```

`usr_intern` still gets `editor` from `default` — union, remember. To make a
real viewer, drop the baseline:

```ts
roles: { editor: ["content:write"] },
members: { usr_intern: [], usr_anna: ["editor"] },
default: [],
```

### Schema annotations

The basics:

```ts
s.object({
  title: s.string(),
  price: s.number().readonly({ unless: "pricing:edit" }),
  internalNotes: s.string().hidden({ unless: "staff:read" }),
});
```

Any one of several is enough:

```ts
salary: s.number().hidden({ unless: ["hr:read", "finance:read"] }),
```

A built-in as the permission — only people who can ship may backdate:

```ts
publishedAt: s.date().readonly({ unless: "publish" }),
```

Part of a section restricted, the rest everyone's — the fields are annotated,
not the section, so the content keeps its shape:

```ts
const seoOnly = { unless: "seo:edit" };

s.object({
  seo: s.object({
    metaDescription: s.string().maxLength(160),
    canonical: s.string().nullable().hidden(seoOnly),
    noindex: s.boolean().hidden(seoOnly),
    structuredData: s.string().hidden(seoOnly),
  }),
});
```

A locked section with one editable field is the same move:

```ts
s.object({
  generated: s.object({
    buildSha: s.string().readonly(),
    builtAt: s.date().readonly(),
    note: s.string(), // a human may annotate
  }),
});
```

Nested restrictions stack — a field has to clear every one on its path:

```ts
s.object({
  a: s
    .object({
      b: s
        .object({
          c: s.string(), // needs hr:read
          d: s.string(), // needs hr:read AND hr:notes
        })
        .hidden({ unless: "hr:notes" }),
    })
    .hidden({ unless: "hr:read" }),
});
```

A child that tries to opt out, and the warning it gets:

```ts
s.object({
  canonical: s.string(),
  metaDescription: s.string().hidden(false),
}).hidden({ unless: "seo:edit" });
// `metaDescription` has .hidden(false), but its parent is hidden for anyone
// without `seo:edit`, so it can never be shown. Restrict the other fields
// instead of the section.
```

Chaining on one field, where the last call wins:

```ts
s.string().hidden().hidden(false); // visible — last call wins
s.string().hidden({ unless: "a" }).hidden({ unless: "b" }); // "b" wins
```

Items of a record or an array:

```ts
tiers: s.record(s.object({ name: s.string(), amount: s.number() }))
  .readonly({ unless: "pricing:edit" }),

authors: s.array(s.object({
  name: s.string(),
  email: s.string().hidden({ unless: "staff:read" }),
})),
```

Media and route:

```ts
heroImage: s.image().readonly({ unless: "design:edit" }),
slug: s.route("/blog/[slug]").readonly({ unless: "publish" }),
```

Both on one field:

```ts
legalText: s.richtext({})
  .readonly({ unless: "legal:edit" })
  .hidden({ unless: "legal:read" }),
```

### Locale scope

The content shape it applies to — a locale-keyed record opens one scope per
language, and `slug` is outside every scope:

```ts
s.object({
  slug: s.string(),
  content: s.record(
    s.locale(),
    s.object({ title: s.string(), body: s.richtext({}) }),
  ),
});
```

For `usr_ola`, `{ "en-US": "read", "nb-NO": "write", "fr-FR": null }`:

| Path                    | `localeAt` | Ola sees   |
| ----------------------- | ---------- | ---------- |
| `content."nb-NO".title` | nb-NO      | edits      |
| `content."en-US".title` | en-US      | reads only |
| `content."fr-FR".title` | fr-FR      | not listed |
| `slug`                  | none       | reads only |

An object with a `locale` field, where each array item is its own scope:

```ts
announcements: s.array(s.object({ locale: s.locale(), headline: s.string() }));
```

Scopes and what they mean, in a project with `en-US`, `nb-NO` and `fr-FR`:

```ts
{ roles: ["translator"] }
// unscoped: every locale, read and write

{ locales: { "en-US": "read", "nb-NO": "write", "fr-FR": null } }
// default's roles, writing Norwegian, reading English, not seeing French

{ locales: { "en-US": "read", "nb-NO": "write", "fr-FR": "read" } }
// reads everything, writes Norwegian

{ locales: { "en-US": "write", "nb-NO": "write", "fr-FR": null } }
// two languages, both written

{ locales: { "en-US": "read", "nb-NO": "write" } }
// ERROR: `fr-FR` is missing — the record is complete; fix: record:fill-keys
```

### Resolution

Given:

```ts
roles:   { editor: ["content:write"], publisher: ["publish"] },
members: { usr_boss: ["publisher"], "boss@company.com": ["admin"] },
default: ["editor"],
```

| User                      | Roles                      | Effective permissions                    |
| ------------------------- | -------------------------- | ---------------------------------------- |
| unlisted                  | editor                     | `content:write`                          |
| `usr_boss` (a.k.a. boss@) | editor + publisher + admin | `content:write`, `publish`, `settings:*` |

Both entries match the same person, so they union — and the Studio warns,
because `/profiles` gives it the email for `usr_boss`.

### Staged content

Field: `notes: s.string().hidden({ unless: "hr:read" })`.

| Situation                                 | A user without `hr:read` sees                            |
| ----------------------------------------- | -------------------------------------------------------- |
| No pending patch                          | nothing                                                  |
| HR has edited it, unpublished             | the field, read-only, with a quiet note saying why       |
| …and they publish                         | nothing again                                            |
| They try to change it                     | they cannot; they can discard it                         |
| A patched field inside a hidden container | the container, drawn only as far as the field, read-only |
| A patch in a locale they cannot read      | the entry, same rule                                     |

The last three are why the rule is stated once over all the axes rather than
per annotation.

### Validation

Errors — self-contained in the settings module:

```ts
members: {
  usr_x: ["shipper"];
}
// `shipper` is not a role. Defined roles: editor, publisher, admin.

locales: { "nb-NOO": "write", /* … */ }
// `nb-NOO` is not one of the project's languages.

locales: { "nb-NO": "edit", /* … */ }
// `edit` is not a level. Use "read", "write" or null.
```

Warnings — the other half lives in code:

```ts
roles: {
  hr: ["hr:raed"];
}
// `hr:raed` is not a permission. No schema requires it and it is not one of
// Val's own. Did you mean `hr:read`?

// nothing grants `pricing:edit`
// `price` is read-only for every user. Add `pricing:edit` to a role.

members: {
  usr_deleted: ["editor"];
}
// no profile found for `usr_deleted`.
```

### Edge cases

```ts
// No section: everyone has everything. Existing projects unchanged.
export default c.define("/settings.val.ts", s.settings(), {});

// Empty section: also everyone has everything. Not a statement that nobody
// may do anything.
access: {
}

// Roles defined, nobody listed, no default: every user gets []. Legal, and
// almost certainly a mistake.
access: {
  roles: {
    editor: ["content:write"];
  }
}

// Local (fs) mode: every permission, no identity to resolve.
```

## Not in this plan

Server-side enforcement of any kind: no `/sources` redaction, no patch-path
rejection, no check on writes to the access section itself. That last one
means the system is advisory over itself — anyone who can send a patch can grant
themselves a role. It is the cheapest thing to add if the framing ever changes,
and it does not change the data shape.
