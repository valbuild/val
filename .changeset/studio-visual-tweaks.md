---
"@valbuild/ui": patch
---

Fix invisible focus rings, the empty rich text toolbar, the Pages count, and iOS zoom

Six rough edges reported from real use. Two of them turned out to be the same
bug, and it is the one worth reading about.

**Every focus ring in the Studio was invisible.** `--ring`, `--background` and
`--input` were declared under `:root` and `.dark`, and neither selector ever
matches: the Studio mounts inside a shadow root with `index.css` linked into it,
and a shadow tree's root is a DocumentFragment, so `:root` matches nothing there
— while `.dark` is dead outright, because dark mode is `[data-mode="dark"]`. So
`hsl(var(--ring))` resolved to `hsl()`. For most properties that degrades
quietly — a background goes transparent, a foreground inherits — but an invalid
colour inside a `box-shadow` takes the whole declaration down, so the ring
painted nothing at all. `border-input` fell back to `currentColor`, which is why
inputs and the rich text editor were outlined in black rather than grey.

None of this was visible where the components were designed: Storybook imports
`index.css` into the _document_, where `:root` does match and every ring renders
correctly. Focus styling now names a `--border-focus` token declared per theme
in a block a shadow root can see, and the ring offset is gone rather than
repointed — measured in Chromium, a stale `ring-offset-background` invalidates
the shadow even at a 0px offset width. `focusRingTokens.test.ts` holds the line,
and the contrast suite holds the new token to 3:1 on all three surfaces.

The same pass gave a focus ring to the controls that had none (the colour
field's alpha slider), gave one a colour (the code editor was falling back to
Tailwind's default blue), and moved the shell and canvas inputs onto the same
ring the rest of the Studio uses.

**A rich text field with no options drew an empty toolbar.** `s.richtext()`
serializes to an options _object_ with every key unset, not to `undefined`, so
the guard meant to catch "no options" never fired and the fixed toolbar was
mounted unconditionally. With every control gated off that produced a ~10px
empty strip whose border doubled the editor's own top border, above 56px of
padding reserved for content that was never there. The bar is now mounted only
when it has something in it, asked through the same functions that build it —
so "is it shown" and "does it have buttons" cannot drift apart. That distinction
is load-bearing: h4-h6 are real features with no toolbar control of their own.

**"Pages 1", on every project.** The count beside the label was the length of a
_tree_, and any project with a home page at `/` nests the whole site under one
root row. It now counts pages recursively, excluding the folder rows that exist
only to hold children.

**Reverted changes no longer look like pending work.** Editing a field and
editing it back leaves patches that are real but amount to nothing. The review
view used to list them as changes showing the same value on both sides, above a
Publish button that would not press — which reads as the Studio having lost the
edit. Modules whose net effect is nothing now fold away under History, and when
that is all that is left the view says so and offers Discard, which is the only
way forward once Publish is off. Publish is disabled in that state with a reason
that says how to clear it, and waits for typing to settle first so it cannot
flicker mid-keystroke.

**Review sits next to Publish**, with a badge that is zeroed when everything has
been reverted, so it never advertises changes that will not ship. Quick actions
gains Discard all, behind a confirm that names the other authors whose work
would go — the same sentence the review view uses. Review moves out of Quick
actions above mobile, where the top bar now carries it: two controls with one
accessible name is ambiguous to a screen reader and a second place to look for
everyone else.

**iOS no longer zooms when you tap a field.** Safari scales the page in whenever
it focuses a control under 16px and does not scale back out, so one tap on a
filter box left the editor magnified for the rest of the session. The viewport
meta cannot fix this — a `<meta>` inside a shadow root is inert, so it would
have to be written into the host page's head, and iOS ignores `user-scalable=no`
regardless — so every typeable control is held at 16px under
`(any-pointer: coarse)`, with a `touch:` variant for the controls that are not
form elements. `any-pointer` rather than `pointer`: a tablet with a keyboard
case, or a touchscreen laptop, reports a fine primary pointer and would have
been missed, while still being able to raise the on-screen keyboard that
triggers the zoom. Desktop density is unchanged.

**And the assistant is usable on a phone.** Its sheet was sized by `maxHeight`
alone, so its height came from its content — and the chat inside it is a
`h-full` column, which collapses on an `auto`-height parent. The transcript
rendered about one message tall and resized on every token that streamed in. The
sheet now takes a definite height and drops its own scroller, so the chat's
scroll area and pinned composer behave.
