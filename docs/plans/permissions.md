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
      publisher: ["content:write", "content:discard", "publish"],
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
  | "content:discard" // DELETE /patches — including other people's work
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
here. Publishing is not locale-gated and `content:discard` throws away other
people's work, so an editor can ship and can destroy changes they cannot
otherwise see. Being unable to look at what you are about to publish is exactly
the mistake this feature exists to prevent.

It follows that a field can appear, be published, and disappear again. That is
correct, and worth a marker in the UI saying why it is showing.

`readonly` is not overridden — the field is shown and still not typeable.
Discarding it is a different action, governed by `content:discard`.

### Permissions are read from the published source

Settings are content, so a user can patch the permissions section. Resolving
against the patched source would let someone unlock their own Studio from an
unpublished draft. `/sources` already takes `exclude_patches`.

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

What is checked:

- A role grants a permission nothing declares → _"`hr:raed` is not a permission.
  No schema requires it and it is not one of Val's own. Did you mean
  `hr:read`?"_
- A member references a role that does not exist.
- `locales.read` / `locales.write` name a language not in `locales.available`.
- `write` is not a subset of `read`.
- A schema requires a permission no role grants → the field is restricted for
  everyone. A **warning**, never an error: it is a legitimate intermediate state
  between the annotation shipping and an admin granting the role.

### Why these should be warnings, not errors

Validation errors block publish. Consider a developer deleting the one field
carrying `.hidden({ unless: "hr:read" })`: the permission stops existing, every
role granting it is invalid, and **publishing is blocked project-wide** until an
admin edits the roles — because someone removed a field.

A dangling permission in settings is otherwise harmless: it is a grant nothing
checks. So this wants `docs/plans/validation-warnings.md` to land first, or to
ship Studio-only as a non-blocking hint on the offending role row.

## Open questions

- **Error or warning** for an unknown permission in settings, per above.
- **Should the Studio refuse a settings patch that leaves nobody with
  `settings:write`?** Recoverable by editing the file, so not fatal, but the
  same class of mistake as discarding someone else's work.
- **Scope on the assignment or on the member?** Currently on the assignment,
  which cannot express "Norwegian editor, and also a global reviewer". Probably
  rare enough to leave.

## Not in this plan

Server-side enforcement of any kind: no `/sources` redaction, no patch-path
rejection, no check on writes to the permissions section itself. That last one
means the system is advisory over itself — anyone who can send a patch can grant
themselves a role. It is the cheapest thing to add if the framing ever changes,
and it does not change the data shape.
