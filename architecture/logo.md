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

**Always green, in both themes.** The mark does not take `currentColor` and does
not invert. `--colors-brand-green-400` is a fixed brand value declared once
outside the light and dark blocks, so it is the same green on dark chrome and on
light. The mark it replaced drew its frame in `currentColor`, which made the logo
a different colour on every surface it appeared on — a brand mark should not
restyle per surface.

**Blink only while loading.** `blinking` animates the caret on and off the way a
terminal cursor does, in SMIL (`calcMode="discrete"` — a cursor is on or off,
never halfway) so the animation travels with the component into the shadow root
instead of needing a keyframe in the SPA stylesheet. It is passed the shell's
`isLoading` and nothing else: a mark that always blinks is a mark always
demanding attention. It must honour `prefers-reduced-motion`, because a blinking
element is one of the few things that specifically hurts people who ask for less
motion.

**The artwork is 19×35.** Much taller than wide, so a square box letterboxes it
to the height — which is what the rail and the round launcher both want.
