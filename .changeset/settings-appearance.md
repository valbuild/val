---
"@valbuild/core": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
---

A project can now make Val Studio look like its own.

`s.settings()` has a new `theme` section, edited under **Settings → Appearance**
in the Studio. It is content like everything else: edited as a draft, shown in
the publish diff, and the same for everyone working on the project.

```ts
export default c.define("/settings.val.ts", s.settings(), {
  theme: {
    accent: "#2563eb",
    radius: "tight",
    mode: "light",
  },
});
```

**`accent` is one hex, and it restyles the whole chrome** — Publish, the active
rail item, focus rings, switches, the caret in a rich text field, and the
outlines the canvas draws around editable elements on your own page. Any colour
is allowed, not a list of approved ones, because what the accent replaces is a
ten-step ramp that is _generated_ from it: each step keeps the lightness of the
step it replaces and changes only the hue. WCAG contrast is almost entirely a
function of lightness, so every foreground/background pair the chrome renders
stays at AA — which is asserted across the hue circle, pure black and a
saturated yellow included, rather than argued for. One value drives both light
and dark mode, since the semantic tokens pick different steps of the ramp in
each.

**`radius`** is `square`, `tight`, `default` or `soft`, and moves every corner
in the Studio.

**`mode`** is the mode the Studio opens in for an editor who has never picked
one. It never overrides an editor who has — that choice stays theirs, per
person and per browser, behind the account button.

Every field is optional, and unset means Val's own look, so an existing
settings module needs no change.

Two smaller fixes that came with it:

- **A settings change is its own entry in the publish diff.** Editing the
  assistant's tone used to collapse the entire settings module into one change
  card labelled "Settings", because the patch that writes a settings field is
  an `add`, and `PatchSets` had no case for a settings section — so it gave up
  and grouped the whole module. Two unrelated settings edits now show as two
  changes, each under the name the panel gives it.
- **The Val mark keeps its green.** It named a step of the brand ramp, so it
  would have recoloured along with a project's accent. It has its own token now.
