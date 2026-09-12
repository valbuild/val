---
"@valbuild/ui": patch
---

Surfaces in the Studio paint the colour they name

Four places named a colour from shadcn's compatibility block — `bg-card`,
`bg-primary-foreground`, and a gradient's stops. None of those tokens is
declared anywhere the Studio can see them: they live under `:root` and `.dark`,
and the Studio renders inside a shadow root (where `:root` matches nothing)
with `darkMode` set to `[data-mode="dark"]` (so `.dark` never matches either).

The effect is quiet, which is why it lasted: an undefined colour is invalid at
computed-value time, so the element simply paints nothing and shows whatever is
behind it. The record list's rows had no background at all, and the fade over a
truncated list row computed to a gradient from transparent to transparent —
no fade.

They now name the Studio's own tokens. Nothing changes colour: each surface was
already showing the page background through the hole, which is the colour it
now paints deliberately — except the truncation fade, which appears again.

`surfaceTokens.test.ts` holds the line, alongside the focus-ring test that
covers the same trap for `box-shadow`. It reads the dead tokens out of
`index.css`, so reviving one lifts the ban on it automatically. The vendored
`components/designSystem/` copies of shadcn are out of scope and still name the
dead tokens.
