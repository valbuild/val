# The Val mark

What the logo is of, so a redraw keeps the meaning and not just the outline.
Drawn in `packages/ui/spa/components/shell/ValLogo.tsx`; there is no image file.

## What it shows

A standing frame, outlined. Inside it, a terminal block caret above a dot.

```
┌───────┐
│       │
│   █   │   the caret: a terminal's block cursor
│       │
│   ●   │   the dot: the brand dot, kept from the old mark
│       │
└───────┘
```

Three ideas, each load-bearing:

- **The frame** is the shape val.build already used — a slab taller than it is
  wide — so the mark stays recognisably Val's. It is an outline rather than a
  solid because the frame is the container for the other two, and a solid one
  leaves nowhere to put them.
- **The caret** is what Val is. Content as code: the content lives in `.val.ts`
  files a developer edits, and a block cursor is the most compact way to say
  "this is a thing you type into" without a glyph of text.
- **The dot** is the brand dot from the old mark, moved under the caret so the
  pair reads as a prompt.

## The joke

A frame with one lit element in it is HAL's portrait, inverted. HAL is a black
slab with a red eye that watches you and decides what you may do. This is a
light frame with a green caret that waits for you to tell it what to do.

The inversion is the whole point, and it only lands if the light is green.

## The rules

**Always green, in both themes.** The mark does not take `currentColor`, does
not invert, and does not follow the project's accent. `--brand-val-green` is
declared once outside the light and dark blocks, so it is the same green on dark
chrome and on light. The mark it replaced drew its frame in `currentColor`, which
made the logo a different colour on every surface it appeared on — a brand mark
should not restyle per surface.

It has its own token rather than naming a step of the brand ramp, and that is
the second half of the same rule. `s.settings()`'s `theme.accent` regenerates
`--colors-brand-green-100` … `-1000` (see `accentRamp` in `@valbuild/shared`),
so while the mark named `--colors-brand-green-400` it turned blue in a
blue-accented Studio — which read as coherent, and was nobody's decision. The
value is a copy of green-400 and deliberately not a `var()` into it: a var would
be overridden with the ramp, which is the thing being avoided.

**A project can replace it in the Studio, and only there.** `s.settings()`'s
`theme.logo` puts the project's own mark at the top of the left rail and beside
the menu button on mobile — the two slots that say which workspace this is.
`StudioMark` is the one component that answers "whose mark, and how is it
sized"; a project without one gets Val's.

It is NOT replaced on the launcher that floats on the project's own site, and
that is a decision rather than an omission. In the Studio the mark labels the
WORKSPACE, and the project's own logo is the right label for it. On the
customer's page the mark labels the TOOL — it is the button that opens Val — and
a company's own logo floating over its own website says nothing at all.

The slot is 32px wide, so it is a slot for a mark. A wide image is contained
rather than cropped: that makes a wordmark small, which is a worse picture but
not a broken one, where cropping the ends off a logo reads as a bug in Val. If a
wordmark ever has to work, the top bar is where there is room for it.

**Blink only while loading.** `blinking` animates the caret on and off the way a
terminal cursor does, in SMIL (`calcMode="discrete"` — a cursor is on or off,
never halfway) so the animation travels with the component into the shadow root
instead of needing a keyframe in the SPA stylesheet. It is passed the shell's
`isLoading` and nothing else: a mark that always blinks is a mark always
demanding attention. It must honour `prefers-reduced-motion`, because a blinking
element is one of the few things that specifically hurts people who ask for less
motion.

The blink belongs to Val's mark alone — an `<img>` cannot do it. So a project
with a logo shows Val's mark blinking while the Studio loads and its own once
the settings arrive, which is the same "the theme turns up with the content"
that the accent has.

**The artwork is 19×35.** Much taller than wide, so a square box letterboxes it
to the height — which is what the rail and the round launcher both want.
