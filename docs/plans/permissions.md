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
   `private`, `confidential` or `denied`.
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
  permissions: {
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
        locales: { read: ["en-US", "nb-NO"], write: ["nb-NO"] },
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

The polarity is in the key rather than positional, because `hidden("editor")`
reads equally well as "hidden from editors" and "hidden from everyone except
editors", and picking wrong is silent.

There is deliberately no `when` / `hiddenFor` inverse. Deny-lists fail open — a
role invented later sees everything nobody thought to exclude it from — and
having both means every field's visibility is a set operation computed in the
reader's head.

Today's forms are untouched: `hidden()`, `hidden(false)`, `readonly()` all keep
their meaning.

**The nearest explicit annotation wins — along the chain and down the tree.**
These are the same rule seen from two directions, and the builder already
commits to it: `hidden()` followed by `hidden(false)` is not a contradiction to
reject, it is an override, because each call replaces the flag on the schema it
returns. Last call wins on one field; deepest annotation wins along a path.

So walking from the module root to a field, the effective value is the one from
the deepest node that says anything. Nodes that say nothing inherit from above,
and `hidden(false)` / `readonly(false)` say something: they are how a child
re-widens what an ancestor restricted.

```ts
s.object({
  band: s.string(),
  jobTitle: s.string().hidden(false), // visible to everyone
}).hidden({ unless: "hr:read" });
```

For `readonly` this is plainly useful — a locked section with one editable
field. For `hidden` it means rendering a container that is itself hidden, as a
shell holding only the children that override it. That is the same mechanism the
staged-content rule below already needs, so it is one piece of machinery with two
callers rather than a new one.

The cost is that a hole can be punched in a restricted container from a child,
and nothing about the container says so. It is explicit in the code and it goes
through review, which is enough for a conscience mechanism.

## Resolution

A user's effective permissions are the union of the permissions of every role
they hold. Their roles are `default` plus whatever their own `members` entry
grants — matched on profile id or email, and unioned when both match.

Two rules that override everything above:

- **No `permissions` section, or an empty one: every user has every
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

It follows that a field can appear, be published, and disappear again. That is
correct, and worth a marker in the UI saying why it is showing.

`readonly` is not overridden — the field is shown and still not typeable.
Discarding it is a different action, and one anyone who may write or publish
can take.

### Permissions are read from the published source

Settings are content, so a user can patch the permissions section. Resolving
against the patched source would let someone unlock their own Studio from an
unpublished draft. `/sources` already takes `exclude_patches`.

One consequence to keep in mind for the guards below: an edit to the permissions
section does not take effect until it is published. An admin who removes their
own access keeps working until someone publishes, and finds out afterwards.

### Editing the permissions section: one refusal and one warning

Editing permissions is the one edit that can take away the ability to make the
next one. Two guards, and the line between them is the same one that decides
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
"ola@company.com": {
  roles: ["translator"],
  locales: { read: ["en-US", "nb-NO"], write: ["nb-NO"] },
}
```

Read and write are separate because a translator who cannot see the source
language cannot translate: Ola reads English to write Norwegian.

**Locale scope narrows exactly one thing: where you can type.** `content:write`
is checked against it; `publish`, `settings:read`,
`settings:write` and `assistant:use` are not, and none of them ever will be by
this mechanism. That is worth stating as a rule rather than leaving as an
accident of which cases came up, because it is what keeps the model small: a
member has a permission set and, separately, a pair of locale sets, and only one
permission consults them.

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

Defaults and rules:

- `locales` absent — every locale, read and write.
- `locales.read` absent — every locale readable.
- `locales.write` absent — defaults to `read`.
- **`write` must be a subset of `read`.** Writing what you cannot see is not a
  configuration, it is a mistake. Validation error.
- Content outside any locale scope — shared images, non-localized fields — is
  **readable and not writable** by a locale-scoped member. This is the
  translator semantic and the safe default; it may prove too strict for someone
  who works in two of three languages.

No shorthand. `locales: ["nb-NO"]` would read equally well as "reads and writes
Norwegian" and as "reads everything, writes Norwegian", which is the same
ambiguity the `unless` key exists to avoid.

**Publish is not locale-gated.** One commit ships the whole pending set, and
splitting that is a bigger change than this is worth. The consequence is that a
Norwegian translator can publish English changes they cannot write — so the
publish confirm should say which locales are in the set, the way the discard
confirm already names whose work it would throw away.

Viewing within the readable set stays a user preference: #608's locale filter is
a filter, not a permission, and a deep link to a readable locale still opens it.
A link to a locale outside `read` explains itself rather than 404ing.

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
- `locales.read` / `locales.write` name a language not in `locales.available`.
- `write` is not a subset of `read`.

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
permissions: {
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
permissions: {
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
permissions: {
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
permissions: {
  roles: {
    translator: ["content:write", "assistant:use"],
    lead: ["content:write", "publish"],
  },
  members: {
    usr_ola: { roles: ["translator"], locales: { read: ["en-US", "nb-NO"], write: ["nb-NO"] } },
    usr_marie: { roles: ["translator"], locales: { read: ["en-US", "fr-FR"], write: ["fr-FR"] } },
    usr_sam: ["lead"],
  },
  default: [],
}
```

Restricted content, with permissions the project invented:

```ts
permissions: {
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
permissions: {
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

A whole section, with a hole punched in it by a child:

```ts
s.object({
  public: s.object({ title: s.string(), body: s.richtext({}) }),
  hr: s
    .object({
      salaryBand: s.string(),
      reviewNotes: s.richtext({}),
      jobTitle: s.string().hidden(false), // everyone sees this one
    })
    .hidden({ unless: "hr:read" }),
});
```

A locked section with one editable field — the same rule, and the case it is
most obviously for:

```ts
s.object({
  generated: s
    .object({
      buildSha: s.string(),
      builtAt: s.date(),
      note: s.string().readonly(false), // a human may annotate
    })
    .readonly(),
});
```

Three levels, nearest wins:

```ts
s.object({
  a: s
    .object({
      b: s.object({
        c: s.string(), // hidden: inherits from `a`
        d: s.string().hidden(false), // visible: `d` is nearest
      }),
    })
    .hidden({ unless: "hr:read" }),
});
```

Chaining, which is the same rule along the other axis:

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

For `usr_ola`, `{ read: ["en-US", "nb-NO"], write: ["nb-NO"] }`:

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

Grants and what they mean:

```ts
{ roles: ["translator"] }
// every locale, read and write

{ roles: ["translator"], locales: { read: ["en-US", "nb-NO"] } }
// write defaults to read: reads and writes both, nothing else

{ roles: ["translator"], locales: { write: ["nb-NO"] } }
// reads everything, writes Norwegian

{ roles: ["translator"], locales: { read: ["nb-NO"], write: ["nb-NO", "fr-FR"] } }
// ERROR: write is not a subset of read
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

| Situation                                 | A user without `hr:read` sees                              |
| ----------------------------------------- | ---------------------------------------------------------- |
| No pending patch                          | nothing                                                    |
| HR has edited it, unpublished             | the field, marked as showing because of the pending change |
| …and they publish                         | nothing again                                              |
| The field is `readonly` for them too      | the field, not typeable, discardable                       |
| A patched field inside a hidden container | the container as a shell, holding it                       |
| A patch in a locale they cannot read      | the entry, same rule                                       |

The last three are why the rule is stated once over all the axes rather than
per annotation.

### Validation

Errors — self-contained in the settings module:

```ts
members: { usr_x: ["shipper"] }
// `shipper` is not a role. Defined roles: editor, publisher, admin.

locales: { read: ["nb-NOO"] }
// `nb-NOO` is not one of the project's languages.

locales: { read: ["nb-NO"], write: ["fr-FR"] }
// `write` must be a subset of `read`: fr-FR is not readable.
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
permissions: {
}

// Roles defined, nobody listed, no default: every user gets []. Legal, and
// almost certainly a mistake.
permissions: {
  roles: {
    editor: ["content:write"];
  }
}

// Local (fs) mode: every permission, no identity to resolve.
```

## Not in this plan

Server-side enforcement of any kind: no `/sources` redaction, no patch-path
rejection, no check on writes to the permissions section itself. That last one
means the system is advisory over itself — anyone who can send a patch can grant
themselves a role. It is the cheapest thing to add if the framing ever changes,
and it does not change the data shape.
