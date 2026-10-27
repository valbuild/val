# Testing the mobile sheets on a real device

The edit sheet and the assistant are sized from `window.visualViewport`
rather than from CSS viewport units, because the iOS keyboard shrinks the
visual viewport and leaves the layout viewport alone. `100vh` overflows,
`100svh` was measured before the keyboard existed, and anything fixed to the
bottom ends up underneath it.

That behaviour cannot be proven in CI. `useVisualViewport.test.ts` pins the
arithmetic and the simulated-keyboard stories show the intended layout, but
only a real handset raises a real keyboard. This is how to try it.

## Serve Storybook to your phone

```bash
pnpm --filter @valbuild/ui run storybook:host
```

That binds to `0.0.0.0` instead of localhost. Find your machine's LAN address
(`ipconfig getifaddr en0` on macOS, `hostname -I` on Linux) and open
`http://<that-address>:6006` on the phone, on the same network.

Storybook's own sidebar eats a lot of a phone screen, so open the story
directly in its iframe:

```
http://<address>:6006/iframe.html?id=shell-overlaymenu--device-test-edit-sheet&viewMode=story
http://<address>:6006/iframe.html?id=shell-overlaymenu--device-test-chat-sheet&viewMode=story
```

Both stories have real `input`/`textarea` fields — tapping one raises the
actual keyboard — and both show a live readout of what the hook reports.

## Reading the readout

Tap a field and watch it:

| line             | what it means                                                   |
| ---------------- | --------------------------------------------------------------- |
| `visible height` | `visualViewport.height` — the part of the screen you can see    |
| `window height`  | `window.innerHeight` — the layout viewport, which does not move |
| `offset top`     | how far Safari has panned the visual viewport down              |
| `keyboard inset` | what the sheet anchors its footer to                            |
| `keyboard`       | whether the gap is large enough to be a keyboard                |

Working correctly, opening the keyboard makes `visible height` drop a few
hundred pixels below `window height`, `keyboard inset` take up that
difference, and `keyboard` flip to `OPEN` — all while the sheet's footer stays
visible.

**If `keyboard inset` stays at `0px` with a keyboard plainly up**, the
VisualViewport API is not reporting on that browser and the sheet has fallen
back to full height. That is the failure this is looking for.

## What to check by hand

1. Focus the chat input: the input and its send button stay visible, above the keyboard.
2. Focus a field in the edit sheet: Save and Cancel stay visible, above the keyboard.
3. With the keyboard up, scroll the sheet's body: only the sheet scrolls — the page behind it does not move.
4. Dismiss the keyboard: the sheet grows back to full height with no gap left behind it.
5. Rotate to landscape with the keyboard up, then back: nothing overflows or gets clipped.
6. Scroll the page to collapse Safari's URL bar, then open a sheet: it does not jump or resize. (A URL bar is ~90px; the threshold that separates it from a keyboard is in `useVisualViewport.ts`.)

## In the real app

The Studio shell's mobile panels and the overlay's windows use the same hook,
so the same checks apply to the example app:

```bash
pnpm run dev:example-next   # from the repo root
```

Then open the example on the phone and use the overlay's assistant, or the
Studio at `/val`.

## Automated geometry check

`scripts/device-lab.mjs` runs the keyboard-sensitive stories against WebKit
(the iOS engine) and asserts nothing overflows horizontally. Desktop WebKit
still does not raise a keyboard, so it checks layout and scrolling only:

```bash
pnpm --filter @valbuild/ui exec playwright install webkit
pnpm --filter @valbuild/ui run device-lab
```
